"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const yaml = require("js-yaml");

const action = yaml.load(readFileSync(path.join(__dirname, "../actions/npm-create-release/action.yml"), "utf8"));
const script = action.runs.steps.find((step) => step.name === "Create or confirm release").run;

function runRelease(status, response, ref = "refs/tags/v1.2.3", remoteSha = "a".repeat(40)) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "create-release-test-"));
  try {
    const calls = path.join(dir, "calls");
    writeFileSync(calls, "");
    writeFileSync(path.join(dir, "gh"), `#!/bin/sh
printf '%s\\n' "$*" >> "$CALLS"
if [ "$1" = api ]; then printf '%s\\n' "$RESPONSE"; exit "$STATUS"; fi
if [ "$1" = release ]; then exit "\${CREATE_STATUS:-0}"; fi
exit 1
`, { mode: 0o755 });
    writeFileSync(path.join(dir, "git"), '#!/bin/sh\nprintf "%s\\t%s\\n" "$REMOTE_SHA" "$GITHUB_REF"\n', { mode: 0o755 });
    const result = spawnSync("bash", ["-e", "-o", "pipefail", "-c", script], {
      encoding: "utf8",
      env: {
        ...process.env, PATH: `${dir}:${process.env.PATH}`, CALLS: calls, STATUS: String(status),
        RESPONSE: response, GITHUB_REF: ref, GITHUB_REPOSITORY: "fulcrumapp/example",
        GITHUB_ACTION_PATH: path.join(__dirname, "../actions/npm-create-release"),
        GITHUB_SHA: "a".repeat(40), REMOTE_SHA: remoteSha,
      },
    });
    return { ...result, calls: readFileSync(calls, "utf8").trim().split("\n").filter(Boolean) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("existing release is confirmed without creating a duplicate", () => {
  const result = runRelease(0, "HTTP/2 200 OK");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.calls.length, 1);
  assert.match(result.stdout, /already exists/);
});

test("only an HTTP 404 creates a verified release", () => {
  const result = runRelease(1, "HTTP/2 404 Not Found");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.calls.length, 2);
  assert.match(result.calls[1], /^release create v1\.2\.3 .*--verify-tag --generate-notes/);
  for (const response of ["HTTP/2 403 Forbidden", "HTTP/2 500 Server Error", "Not Found (HTTP 404)", ""]) {
    const failed = runRelease(1, response);
    assert.notEqual(failed.status, 0);
    assert.equal(failed.calls.length, 1);
  }
  const prerelease = runRelease(0, "HTTP/2 200 OK", "refs/tags/v1.2.3-rc.1");
  assert.notEqual(prerelease.status, 0);
  assert.equal(prerelease.calls.length, 0);
  const moved = runRelease(1, "HTTP/2 404 Not Found", "refs/tags/v1.2.3", "b".repeat(40));
  assert.notEqual(moved.status, 0);
  assert.equal(moved.calls.length, 1);
  assert.match(moved.stderr, /no longer points/);
  const movedExisting = runRelease(0, "HTTP/2 200 OK", "refs/tags/v1.2.3", "b".repeat(40));
  assert.notEqual(movedExisting.status, 0);
  assert.equal(movedExisting.calls.length, 1);
});
