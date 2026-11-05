"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const manifest = require("../../package.json");
const [pack] = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--ignore-scripts", "--json"], {
  encoding: "utf8"
}));
const files = new Set(pack.files.map((file) => file.path));

assert.equal(pack.name, manifest.name);
assert.equal(pack.version, manifest.version);
assert.equal(manifest.name, "@fulcrumapp/v8-sandbox");
for (const file of [
  "package.json", "binding.gyp", "src/addon.cc", "src/baton.cc", "src/baton.h",
  "src/common.h", "src/sandbox.cc", "src/sandbox.h", "dist/index.js",
  "dist/cluster/worker.js", "dist/sandbox/worker.js", "dist/sandbox/runtime.js"
]) {
  assert.ok(files.has(file), `Package is missing ${file}`);
}
assert.ok(![...files].some((file) => file.startsWith("build/") || file.endsWith(".node")),
  "Package must not contain runner-specific native binaries");
assert.ok(!manifest.scripts.install && !manifest.scripts.preinstall,
  "npm must be able to run its default node-gyp install hook");
console.log("Package contains the native build inputs and runtime files.");
