"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { calculateVersion, classify } = require("../actions/npm-next-version/next-version.js");
const { createReleaseTag } = require("../actions/npm-create-tag/create-tag.js");

function inRepository(callback) {
  const directory = mkdtempSync(path.join(tmpdir(), "npm-next-version-"));
  const original = process.cwd();
  const git = (...args) => execFileSync("git", args, { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  try {
    git("init", "--quiet");
    git("config", "user.name", "Test");
    git("config", "user.email", "test@example.com");
    process.chdir(directory);
    callback(git, directory);
  } finally {
    process.chdir(original);
    rmSync(directory, { recursive: true, force: true });
  }
}

function commit(git, directory, message, manifest) {
  const ref = git("symbolic-ref", "HEAD");
  let parent = "";
  try {
    parent = `from ${git("rev-parse", "--verify", "HEAD")}\n`;
  } catch {
    // An orphan branch has no parent.
  }
  const data = `${message}\n`;
  const content = `${message}\n`;
  const packageFile = manifest === undefined ? "" : `M 100644 inline package.json\ndata ${Buffer.byteLength(manifest)}\n${manifest}\n`;
  const stream = `commit ${ref}\ncommitter Fixture <fixture@example.com> 1700000000 +0000\ndata ${Buffer.byteLength(data)}\n${data}${parent}M 100644 inline content\ndata ${Buffer.byteLength(content)}\n${content}\n${packageFile}`;
  execFileSync("git", ["fast-import", "--quiet"], { cwd: directory, input: stream, stdio: ["pipe", "pipe", "pipe"] });
  return git("rev-parse", "HEAD");
}

test("classifies conventional commits with breaking changes taking precedence", () => {
  assert.equal(classify(["fix: bug", "feat(api): new"]), "minor");
  assert.equal(classify(["feat: new", "fix(api)!: incompatible"]), "major");
  assert.equal(classify(["fix: bug\n\nBREAKING CHANGE: incompatible"]), "major");
  assert.equal(classify(["fix: bug\n\nBREAKING-CHANGE: incompatible"]), "major");
  assert.equal(classify(["feature: not a conventional feat", "chore: clean"]), "patch");
});

test("increments the committed package version when no stable tag exists", () => {
  for (const [version, message, expected] of [
    ["1.0.0", "fix: bug", "1.0.1"],
    ["1.0.0", "feat: new", "1.1.0"],
    ["1.2.3", "feat!: change", "2.0.0"],
    ["0.0.0", "fix: bug", "0.0.1"],
    ["9.99.99", "feat: new", "9.100.0"]
  ]) {
    inRepository((git, directory) => {
      const head = commit(git, directory, message, JSON.stringify({ version }));
      git("tag", "v99.0.0-rc.1");
      assert.equal(calculateVersion(head).version, expected);
    });
  }
});

test("fails closed when the committed initial package version is missing or invalid", () => {
  for (const manifest of [undefined, "{}", "{", '{"version":"1.0.0-rc.1"}', '{"version":"01.0.0"}']) {
    inRepository((git, directory) => {
      const head = commit(git, directory, "fix: bug", manifest);
      assert.throws(() => calculateVersion(head), /package\.json/i);
    });
  }
});

test("uses the tested commit, not an uncommitted package version", () => {
  inRepository((git, directory) => {
    const head = commit(git, directory, "fix: bug", '{"version":"1.0.0"}');
    writeFileSync(path.join(directory, "package.json"), '{"version":"100.0.0"}');
    assert.equal(calculateVersion(head).version, "1.0.1");
  });
});

test("selects the highest stable tag, ignores prereleases, and analyzes the full range", () => {
  inRepository((git, directory) => {
    commit(git, directory, "chore: initial", '{"version":"1.0.0"}');
    git("tag", "v1.9.9");
    git("tag", "v1.10.0");
    git("tag", "v99.0.0-rc.1");
    commit(git, directory, "feat: feature");
    const head = commit(git, directory, "fix: follow-up");
    const result = calculateVersion(head);
    assert.equal(result.previousTag, "v1.10.0");
    assert.equal(result.tag, "v1.11.0");
    assert.equal(result.bump, "minor");
  });
});

test("increments the latest tag when its package version is older", () => {
  inRepository((git, directory) => {
    commit(git, directory, "chore: legacy release", '{"version":"1.0.0"}');
    git("tag", "v1.0.1");
    const head = commit(git, directory, "fix: follow-up");
    const result = calculateVersion(head);
    assert.equal(result.previousTag, "v1.0.1");
    assert.equal(result.tag, "v1.0.2");
  });
});

test("increments the committed package version when it is newer than the latest tag", () => {
  for (const [message, expected] of [["fix: follow-up", "1.1.1"], ["feat: follow-up", "1.2.0"], ["feat!: change", "2.0.0"]]) {
    inRepository((git, directory) => {
      commit(git, directory, "chore: initial", '{"version":"1.0.0"}');
      git("tag", "v1.0.0");
      commit(git, directory, "chore(release): v1.1.0 [skip ci]", '{"version":"1.1.0"}');
      const head = commit(git, directory, message);
      const plan = calculateVersion(head);
      assert.equal(plan.previousTag, "v1.0.0");
      assert.equal(plan.version, expected);
    });
  }
});

test("does not reuse a higher untagged release version after a package version reset", () => {
  for (const withTag of [false, true]) {
    inRepository((git, directory) => {
      commit(git, directory, "chore: initial", '{"version":"1.0.0"}');
      if (withTag) git("tag", "v1.0.0");
      commit(git, directory, "chore(release): v1.1.0 [skip ci]", '{"version":"1.1.0"}');
      const head = commit(git, directory, "fix: follow-up", '{"version":"1.0.0"}');
      assert.equal(calculateVersion(head).version, "1.1.1");
    });
  }
});

test("handles a release-only commit and recognizes a rerun", () => {
  inRepository((git, directory) => {
    const releasedMain = commit(git, directory, "feat: first", '{"version":"0.9.0"}');
    commit(git, directory, "chore(release): v1.0.0");
    git("tag", "v1.0.0");
    git("checkout", "--quiet", "-b", "next", releasedMain);
    assert.equal(calculateVersion(releasedMain).alreadyReleased, true);
    const head = commit(git, directory, "fix: next");
    const result = calculateVersion(head);
    assert.equal(result.base, releasedMain);
    assert.equal(result.tag, "v1.0.1");
  });
});

test("does not suppress a main release because an off-main descendant has a higher tag", () => {
  inRepository((git, directory) => {
    const head = commit(git, directory, "feat: validated main", '{"version":"1.0.0"}');
    commit(git, directory, "chore: legacy release", '{"version":"2.0.0"}');
    git("tag", "v2.0.0");
    git("checkout", "--quiet", "-b", "tested-main", head);
    const options = {
      head, repository: "fulcrumapp/example", runId: "1", attempt: "1", eventName: "push",
      ref: "refs/heads/main", git, calculateVersion,
      gh: () => JSON.stringify({ object: { sha: head } }),
    };
    assert.throws(() => createReleaseTag(options), /does not point to the current validated main commit/);
  });
});

test("fails when the highest tag is unrelated to the tested commit", () => {
  inRepository((git, directory) => {
    const head = commit(git, directory, "fix: main");
    git("checkout", "--quiet", "--orphan", "other");
    commit(git, directory, "feat: unrelated");
    git("tag", "v2.0.0");
    assert.throws(() => calculateVersion(head), /no common history/);
  });
});

test("refuses a shallow checkout even when its visible tags appear valid", () => {
  inRepository((git, directory) => {
    commit(git, directory, "fix: initial");
    git("tag", "v1.0.0");
    commit(git, directory, "feat: next");
    const clone = mkdtempSync(path.join(tmpdir(), "npm-next-version-shallow-"));
    try {
      execFileSync("git", ["clone", "--quiet", "--depth=1", `file://${directory}`, clone]);
      process.chdir(clone);
      assert.throws(() => calculateVersion("HEAD"), /Complete Git history/);
    } finally {
      process.chdir(directory);
      rmSync(clone, { recursive: true, force: true });
    }
  });
});
