"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { verifyIdentity, verifyRemoteIdentity } = require("../actions/npm-release-identity/identity.js");

const sha = "a".repeat(40);
const makeCommit = (id) => ({
  oid: sha, author: { user: { databaseId: id } },
  signature: { isValid: true, wasSignedByGitHub: true }
});

test("requires a GitHub signature, regardless of author", () => {
  for (const id of [350331494, 278782705, 12345]) {
    assert.doesNotThrow(() => verifyIdentity(makeCommit(id), "fulcrumapp/example", sha));
  }
  assert.doesNotThrow(() => verifyIdentity({ ...makeCommit(350331494), author: null }, "fulcrumapp/example", sha));
  for (const commit of [
    { ...makeCommit(350331494), oid: "b".repeat(40) },
    { ...makeCommit(350331494), signature: { isValid: false, wasSignedByGitHub: true } },
    { ...makeCommit(350331494), signature: { isValid: true, wasSignedByGitHub: false } }
  ]) assert.throws(() => verifyIdentity(commit, "fulcrumapp/example", sha), /GitHub signature/);
});

test("queries GitHub for the exact tagged commit and fails closed on errors", () => {
  const gh = (args, input) => {
    assert.ok(args.includes("graphql"));
    assert.deepEqual(JSON.parse(input).variables, { owner: "fulcrumapp", name: "fulcrum-js", oid: sha });
    return JSON.stringify({ data: { repository: { object: makeCommit(350331494) } } });
  };
  assert.doesNotThrow(() => verifyRemoteIdentity(gh, "fulcrumapp/fulcrum-js", sha));
  assert.throws(() => verifyRemoteIdentity(() => '{"errors":[{}]}', "fulcrumapp/fulcrum-js", sha));
  assert.throws(() => verifyRemoteIdentity(gh, "fulcrumapp/fulcrum-js", "invalid"));
});
