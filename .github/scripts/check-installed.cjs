"use strict";

const assert = require("node:assert/strict");
const { Sandbox } = require(process.argv[2]);

async function main() {
  const sandbox = new Sandbox();
  try {
    const result = await sandbox.execute({ code: "setResult({value: 42})", timeout: 5000 });
    assert.ifError(result.error);
    assert.equal(result.value, 42);
    console.log("Installed package compiled and executed its native sandbox.");
  } finally {
    await sandbox.shutdown();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
