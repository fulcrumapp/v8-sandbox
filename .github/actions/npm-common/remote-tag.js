"use strict";

const { execFileSync } = require("node:child_process");

const stableTag = /^refs\/tags\/v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

function verifyRemoteTag(ref, eventSha, listing, rejectNewer = false) {
  const current = stableTag.exec(ref || "");
  if (!current) throw new Error("A stable release tag is required.");
  if (!/^[0-9a-f]{40,64}$/.test(eventSha || "")) throw new Error("A valid triggering commit SHA is required.");
  const currentVersion = current.slice(1).map(BigInt);
  let tagObject;
  let peeledTag;
  for (const line of listing.trim().split("\n")) {
    const match = /^([0-9a-f]{40,64})\t(refs\/tags\/[^\s^]+)(\^\{\})?$/.exec(line);
    if (!match) throw new Error("Unable to parse the remote tag listing.");
    if (match[2] === ref) {
      if (match[3]) {
        if (peeledTag) throw new Error("Duplicate peeled release tag in remote listing.");
        peeledTag = match[1];
      } else {
        if (tagObject) throw new Error("Duplicate release tag in remote listing.");
        tagObject = match[1];
      }
    }
    if (match[3] || !rejectNewer) continue;
    const tag = stableTag.exec(match[2]);
    if (!tag) continue;
    const version = tag.slice(1).map(BigInt);
    for (let i = 0; i < version.length; i++) {
      if (version[i] > currentVersion[i]) {
        throw new Error(`A newer stable release tag exists: ${match[2]}. Refusing to deploy ${ref}.`);
      }
      if (version[i] < currentVersion[i]) break;
    }
  }
  if (!tagObject) throw new Error("The triggering release tag no longer exists on origin.");
  if ((peeledTag || tagObject) !== eventSha) {
    throw new Error("The remote release tag no longer points to the triggering commit.");
  }
}

function verifyOriginTag(ref, eventSha, rejectNewer = false) {
  const listing = execFileSync("git", ["ls-remote", "--tags", "origin"], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 16 * 1024 * 1024,
  });
  verifyRemoteTag(ref, eventSha, listing, rejectNewer);
}

if (require.main === module) {
  try {
    if (process.argv.length > 3 || (process.argv[2] && process.argv[2] !== "--reject-newer")) {
      throw new Error("Expected no arguments or --reject-newer.");
    }
    verifyOriginTag(process.env.GITHUB_REF, process.env.GITHUB_SHA, process.argv[2] === "--reject-newer");
  } catch (error) {
    console.error(`::error::Unable to verify remote release tag: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { verifyRemoteTag, verifyOriginTag };
