const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const workflows = path.resolve(__dirname, "../workflows");
const workflow = readFileSync(path.join(workflows, "ci.yml"), "utf8");
const buildJob = workflow.match(/^  ci:\n([\s\S]*?)(?=^  build-and-test:)/m)?.[1];
assert.ok(buildJob, "CI job is present");
const guard = buildJob.match(/node <<'NODE'\n([\s\S]*?)^\s*NODE$/m)?.[1];
assert.ok(guard, "version guard is present");

test("release tagging uses the public CI App secrets", () => {
  assert.match(workflow, /app-id:\s*\$\{\{\s*secrets\.FULCRUM_CI_APP_ID_PUBLIC\s*\}\}/);
  assert.match(workflow, /private-key:\s*\$\{\{\s*secrets\.FULCRUM_CI_APP_PRIVATE_KEY_PUBLIC\s*\}\}/);
  assert.doesNotMatch(workflow, /secrets\.FULCRUM_CI_APP_(?:ID|PRIVATE_KEY)\s*\}\}/);
});

test("PRs, merge queue, and main are validated before main-only tagging", () => {
  const config = require("js-yaml").load(workflow);
  assert.equal(config.on.pull_request.branches, undefined);
  assert.equal(config.jobs.ci.if, undefined);
  assert.deepEqual(config.on.merge_group.types, ["checks_requested"]);
  assert.deepEqual(config.on.push.branches, ["main"]);
  assert.deepEqual(config.permissions, { contents: "read" });
  assert.equal(config.jobs.tag.needs, "build-and-test");
  assert.equal(config.jobs.tag.if, "github.event_name == 'push' && github.ref == 'refs/heads/main'");
  assert.equal(config.jobs.tag.steps.at(-1).env.CHECK_NPMJS, "false");
});

function runCheck(base, head, sha = "a".repeat(40)) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "version-policy-"));
  try {
    if (base !== null) writeFileSync(path.join(dir, "base"), base);
    if (head !== null) writeFileSync(path.join(dir, "head"), head);
    writeFileSync(path.join(dir, "git"), `#!/bin/sh
case "$2" in
  HEAD:package.json) cat "$FIXTURES/head" ;;
  *:package.json) cat "$FIXTURES/base" ;;
  *) exit 1 ;;
esac
`, { mode: 0o755 });
    return spawnSync(process.execPath, ["-e", guard], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, FIXTURES: dir, BASE_SHA: sha }
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("event bases, checkout and GitHub-hosted runners are configured", () => {
  for (const field of ["pull_request.base.sha", "merge_group.base_sha", "event.before"]) {
    assert.ok(buildJob.includes(field), field);
  }
  assert.match(buildJob, /fetch-depth:\s*0/);
  assert.match(buildJob, /runs-on:\s*ubuntu-latest/);
  assert.match(workflow, /^  tag:[\s\S]*?runs-on:\s*ubuntu-latest/m);
  assert.match(workflow, /node --test \.github\/tests\/\*\.cjs/);
  if (/^  sonar:/m.test(workflow)) assert.match(workflow, /^  sonar:[\s\S]*?runs-on:\s*ubuntu-latest/m);
});

test("all workflow jobs use GitHub-hosted Ubuntu runners", () => {
  for (const name of readdirSync(workflows).filter((file) => /\.ya?ml$/.test(file))) {
    const contents = readFileSync(path.join(workflows, name), "utf8");
    for (const line of contents.match(/^\s+runs-on:.*$/gm) || []) {
      assert.match(line, /^\s+runs-on:\s*ubuntu-latest\s*$/, `${name}: ${line}`);
    }
  }
});

test("the version guard accepts unchanged versions and rejects invalid changes", () => {
  const original = '{"version":"1.2.3","dependencies":{"a":"1"}}';
  const cases = [
    [original, original, true],
    [original, '{"version":"1.2.3","dependencies":{"a":"2"}}', true],
    [original, '{"version":"1.2.4"}', false],
    [original, null, false],
    [null, original, false],
    [original, "{", false],
    [original, "{}", false],
    [original, '{"version":""}', false]
  ];
  for (const [base, head, expected] of cases) {
    const result = runCheck(base, head);
    assert.equal(result.status === 0, expected, result.stderr);
    if (head === '{"version":"1.2.4"}') assert.match(result.stderr, /Do not manually change/);
  }
  const missingBase = runCheck(original, original, "0".repeat(40));
  assert.notEqual(missingBase.status, 0);
  assert.match(missingBase.stderr, /base/);
});

test("publish workflows use tag creation and appropriate runners", () => {
  for (const name of ["publish"]) {
    const publish = readFileSync(path.join(workflows, `${name}.yml`), "utf8");
    assert.match(publish, /^  create:/m);
    assert.doesNotMatch(publish, /^  push:/m);
    assert.match(publish, /github\.ref_type == 'tag'/);
    assert.match(publish, /^  publish:[\s\S]*?runs-on:\s*ubuntu-latest/m);
    assert.match(publish, /^  release:[\s\S]*?runs-on:\s*ubuntu-latest/m);
  }
});

test("only stable tags reach package publishing and release notes", () => {
  const yaml = require("js-yaml");
  const publish = yaml.load(readFileSync(path.join(workflows, "publish.yml"), "utf8"));
  const classifier = publish.jobs["classify-tag"];
  assert.equal(classifier.if, "github.ref_type == 'tag'");
  assert.equal(classifier.outputs.is_stable, "${{ steps.classify.outputs.is_stable }}");
  assert.equal(publish.jobs.publish.needs, "classify-tag");
  assert.equal(publish.jobs.publish.if, "needs.classify-tag.outputs.is_stable == 'true'");
  assert.equal(publish.jobs.release.needs, "publish");
  const dir = mkdtempSync(path.join(os.tmpdir(), "publish-tag-policy-"));
  try {
    const output = path.join(dir, "output");
    const script = classifier.steps.find((step) => step.id === "classify").run;
    for (const [ref, stable] of [
      ["refs/tags/v0.0.0", true], ["refs/tags/v12.3.456", true],
      ["refs/tags/v1.2.3-rc.1", false], ["refs/tags/v1.2.3+build", false],
      ["refs/tags/v01.2.3", false], ["refs/tags/v1.2", false], ["refs/heads/main", false]
    ]) {
      writeFileSync(output, "");
      const result = spawnSync("bash", ["-e", "-o", "pipefail", "-c", script], {
        encoding: "utf8", env: { ...process.env, GITHUB_REF: ref, GITHUB_OUTPUT: output }
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(readFileSync(output, "utf8"), `is_stable=${stable}\n`, ref);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("GitHub Packages publishing installs npm 11 before packing without scripts", () => {
  const action = readFileSync(path.join(__dirname, "../actions/npm-publish-github/action.yml"), "utf8");
  const install = action.indexOf("npm install --global npm@11.5.1 --ignore-scripts");
  const pack = action.indexOf("npm pack --ignore-scripts --json");
  assert.ok(install >= 0 && pack > install, "npm 11 must be installed before packing");
});

test("Yarn commands cannot modify the tagged package manifest through Corepack auto-pinning", () => {
  const yaml = require("js-yaml");
  const action = yaml.load(readFileSync(path.join(__dirname, "../actions/npm-publish-github/action.yml"), "utf8"));
  for (const step of action.runs.steps.filter((step) => /(?:corepack|yarn)\b/.test(step.run || ""))) {
    assert.equal(step.env?.COREPACK_ENABLE_AUTO_PIN, "0", step.name);
  }
  const config = yaml.load(workflow);
  assert.equal(config.jobs.ci.env.COREPACK_ENABLE_AUTO_PIN, "0");
});

test("CI and the publisher rebuild and verify the native package", () => {
  const yaml = require("js-yaml");
  const config = yaml.load(workflow);
  const ciSteps = config.jobs.ci.steps;
  assert.equal(ciSteps.find((step) => step.name === "Build distribution").run, "yarn clean && yarn build");
  assert.equal(ciSteps.find((step) => step.name === "Type check").run, "yarn typecheck");
  assert.equal(ciSteps.find((step) => step.name === "Test").run, "yarn test");
  assert.equal(ciSteps.find((step) => step.name === "Check package contents").run,
    "node .github/scripts/check-package.cjs");
  assert.match(ciSteps.find((step) => step.name === "Install and exercise packed package").run,
    /npm install[\s\S]*node \.github\/scripts\/check-installed\.cjs/);
  const action = yaml.load(readFileSync(path.join(__dirname, "../actions/npm-publish-github/action.yml"), "utf8"));
  assert.equal(action.runs.steps.find((step) => step.name === "Build package").run,
    "yarn clean && yarn build && node .github/scripts/check-package.cjs");
});
