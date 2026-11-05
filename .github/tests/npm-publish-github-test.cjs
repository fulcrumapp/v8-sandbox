"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const { publishPackage: publish, verifyRelease, verifyCheckout } = require("../actions/npm-publish-github/publish.js");

function publishPackage(pkg, npm, tarball, integrity) {
  return publish(pkg, npm, tarball, () => {}, integrity);
}

const pkg = { name: "@fulcrumapp/v8-sandbox", version: "3.2.1" };
const registry = "https://npm.pkg.github.com/";
const e404 = JSON.stringify({ error: { code: "E404", summary: "Not Found" } }, null, 2);

function npmSequence(results) {
  const calls = [];
  const npm = (...args) => {
    calls.push(args);
    assert.ok(results.length, "Unexpected npm invocation");
    return results.shift();
  };
  return { npm, calls };
}

test("publishes the tarball once for structured E404 on stdout or stderr", () => {
  const mixedStderr = spawnSync(process.execPath, ["-e", `
    console.error("npm error code E404");
    console.error(${JSON.stringify(e404)});
    console.error("npm error A complete log can be found elsewhere");
    process.exitCode = 1;
  `], { encoding: "utf8" });
  for (const missing of [
    { status: 1, stdout: e404, stderr: "npm error code E404" },
    mixedStderr,
    { status: 1, stdout: "", stderr: e404 }
  ]) {
    const { npm, calls } = npmSequence([missing, { status: 0 }]);
    assert.equal(publishPackage(pkg, npm, "package.tgz"), "published");
    assert.deepEqual(calls, [
      ["view", `${pkg.name}@${pkg.version}`, "version", "--json", `--registry=${registry}`],
      ["publish", "package.tgz", "--ignore-scripts", `--registry=${registry}`, `--@fulcrumapp:registry=${registry}`]
    ]);
  }
});

test("an existing package is idempotent only when the tarball integrity matches", () => {
  const version = { status: 0, stdout: JSON.stringify(pkg.version) };
  const { npm, calls } = npmSequence([version, { status: 0, stdout: '"sha512-matching"' }]);
  assert.equal(publishPackage(pkg, npm, "package.tgz", () => "sha512-matching"), "already published");
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], ["view", `${pkg.name}@${pkg.version}`, "dist.integrity", "--json", `--registry=${registry}`]);
  for (const stored of [
    { status: 0, stdout: '"sha512-different"' },
    { status: 1, stdout: '"sha512-matching"' },
    { status: 1, stdout: "not JSON" }
  ]) {
    const attempt = npmSequence([version, stored]);
    assert.throws(() => publishPackage(pkg, attempt.npm, "package.tgz", () => "sha512-matching"), /integrity/);
    assert.equal(attempt.calls.length, 2);
  }
});

test("registry failures, ambiguous output, and invalid version responses never publish", () => {
  const auth = JSON.stringify({ error: { code: "E401" } });
  const failures = [
    { status: 1, stdout: auth, stderr: "" },
    { status: 1, stdout: "", stderr: auth },
    { status: 1, stdout: "", stderr: "npm error code E404" },
    { status: 1, stdout: "{not json", stderr: e404 },
    { status: 1, stdout: auth, stderr: e404 },
    { status: 1, stdout: e404, stderr: auth },
    { status: null, stdout: e404, stderr: "" },
    { status: 1, stdout: "", stderr: "network error" },
    { status: 0, stdout: "not json", stderr: "" },
    { status: 0, stdout: '"3.2.2"', stderr: "" }
  ];
  for (const failure of failures) {
    const { npm, calls } = npmSequence([failure]);
    assert.throws(() => publishPackage(pkg, npm, "package.tgz"));
    assert.equal(calls.length, 1);
  }
});

test("publish errors are propagated", () => {
  const { npm, calls } = npmSequence([
    { status: 1, stdout: e404 },
    { status: 1, stderr: "permission denied" }
  ]);
  assert.throws(() => publishPackage(pkg, npm, "package.tgz"), /npm publish failed.*permission denied/);
  assert.equal(calls.length, 2);
});

test("rechecks the remote tag immediately before publishing or accepting an existing package", () => {
  const missing = npmSequence([{ status: 1, stdout: e404 }, { status: 0 }]);
  assert.throws(() => publish(pkg, missing.npm, "package.tgz", () => {
    assert.equal(missing.calls.length, 1);
    throw new Error("tag moved");
  }), /tag moved/);
  assert.equal(missing.calls.length, 1);

  const existing = npmSequence([
    { status: 0, stdout: JSON.stringify(pkg.version) },
    { status: 0, stdout: '"sha512-matching"' }
  ]);
  assert.throws(() => publish(pkg, existing.npm, "package.tgz", () => {
    assert.equal(existing.calls.length, 2);
    throw new Error("tag deleted");
  }, () => "sha512-matching"), /tag deleted/);
  assert.equal(existing.calls.length, 2);
  assert.throws(() => publish(pkg, () => { throw new Error("unexpected npm call"); }, "package.tgz"),
    /Remote tag verification is required/);
});

function releaseGit(overrides = {}) {
  const values = {
    "rev-list --parents -n 1 HEAD": "head parent",
    "merge-base --is-ancestor HEAD refs/remotes/origin/main": "",
    "show -s --format=%B HEAD": "chore(release): v3.2.1 [skip ci]",
    "diff --name-only parent..HEAD": "package.json",
    "show parent:package.json": JSON.stringify({ ...pkg, version: "3.2.0" }),
    "show HEAD:package.json": JSON.stringify(pkg),
    ...overrides
  };
  return (...args) => {
    const key = args.join(" ");
    assert.ok(Object.hasOwn(values, key), `Unexpected git command: ${key}`);
    return values[key];
  };
}

test("requires the generated release commit message and an actual version change", () => {
  assert.deepEqual(verifyRelease("refs/tags/v3.2.1", pkg, releaseGit()), pkg);
  for (const message of [
    "update package",
    "chore(release): v3.2.0 [skip ci]",
    "chore(release): v3.2.1 [skip ci]\n\nextra content"
  ]) {
    assert.throws(() => verifyRelease("refs/tags/v3.2.1", pkg,
      releaseGit({ "show -s --format=%B HEAD": message })), /commit message/);
  }
  assert.throws(() => verifyRelease("refs/tags/v3.2.1", pkg,
    releaseGit({ "show parent:package.json": JSON.stringify(pkg) })), /must change/);
});

test("the checked-out commit and tag must both match the create event snapshot", () => {
  const sha = "a".repeat(40);
  const ref = "refs/tags/v3.2.1";
  const git = (head, tag) => (...args) => {
    if (args.join(" ") === "rev-parse HEAD") return head;
    if (args.join(" ") === `rev-parse --verify ${ref}^{commit}`) return tag;
    throw new Error("Unexpected git call");
  };
  assert.equal(verifyCheckout(ref, sha, git(sha, sha)), sha);
  assert.throws(() => verifyCheckout(ref, sha, git("b".repeat(40), sha)), /triggering revision/);
  assert.throws(() => verifyCheckout(ref, sha, git(sha, "b".repeat(40))), /triggering revision/);
  assert.throws(() => verifyCheckout(ref, "", git(sha, sha)), /triggering revision/);
  assert.throws(() => verifyCheckout("refs/heads/main", sha, git(sha, sha)), /stable SemVer/);
});
