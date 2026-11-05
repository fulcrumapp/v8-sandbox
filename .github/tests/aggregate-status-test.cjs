"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const workflows = path.resolve(__dirname, "../workflows");
const workflow = readFileSync(path.join(workflows, "ci.yml"), "utf8");
const aggregate = workflow.match(/^  build-and-test:\n([\s\S]*?)(?=^  tag:)/m)?.[1];
assert.ok(aggregate, "required build-and-test job is present");
const script = aggregate.match(/        run: \|\n([\s\S]*)/)?.[1]?.replace(/^          /gm, "");
assert.ok(script, "aggregate job has a result check");
const results = ["CI_RESULT", "LINT_RESULT", "TEST_RESULT", "SONAR_RESULT"]
  .filter((name) => aggregate.includes(`${name}:`));

function run(values) {
  return spawnSync("bash", ["-e", "-o", "pipefail", "-c", script], {
    encoding: "utf8", env: { ...process.env, ...values }
  });
}

test("the required check and tag depend on successful validation", () => {
  assert.match(aggregate, /always\(\)/);
  assert.match(workflow, /^  tag:[\s\S]*?needs: build-and-test/m);
  const success = Object.fromEntries(results.map((name) => [name, "success"]));
  assert.equal(run(success).status, 0);
  for (const name of results) {
    assert.notEqual(run({ ...success, [name]: "failure" }).status, 0, name);
    if (name !== "SONAR_RESULT") assert.notEqual(run({ ...success, [name]: "skipped" }).status, 0, name);
  }
  if (results.includes("SONAR_RESULT")) {
    assert.equal(run({ ...success, SONAR_RESULT: "skipped" }).status, 0);
  }
});
