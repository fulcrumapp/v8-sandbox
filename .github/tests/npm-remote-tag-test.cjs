"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { verifyRemoteTag } = require("../actions/npm-common/remote-tag.js");

const sha = "a".repeat(40);
const other = "b".repeat(40);
const ref = "refs/tags/v1.2.3";
const line = (oid, tag = ref) => `${oid}\t${tag}\n`;

test("requires the remote lightweight or peeled annotated tag to match the event", () => {
  for (const listing of [line(sha), line(other) + line(sha, `${ref}^{}`)]) {
    assert.doesNotThrow(() => verifyRemoteTag(ref, sha, listing));
  }
  for (const listing of [
    line(other), line(other) + line(other, `${ref}^{}`), line(sha, `${ref}^{}`),
    line(sha) + line(other), "", "malformed"
  ]) {
    assert.throws(() => verifyRemoteTag(ref, sha, listing));
  }
  assert.throws(() => verifyRemoteTag(ref, "", line(sha)), /SHA/);
  assert.throws(() => verifyRemoteTag("refs/tags/v1.2.3-rc.1", sha, line(sha)), /stable/);
});

test("newer releases block deployment but do not prevent package recovery", () => {
  const listing = line(sha) + line(other, "refs/tags/v1.3.0");
  assert.doesNotThrow(() => verifyRemoteTag(ref, sha, listing));
  assert.throws(() => verifyRemoteTag(ref, sha, listing, true), /newer stable release/);
  assert.doesNotThrow(() => verifyRemoteTag(ref, sha, line(sha) + line(other, "refs/tags/v1.3.0-rc.1"), true));
});
