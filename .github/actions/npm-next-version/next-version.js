#!/usr/bin/env node
"use strict";

const { execFileSync, spawnSync } = require("node:child_process");
const { appendFileSync } = require("node:fs");

const stableTag = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const releaseSubject = /^chore\(release\): (v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)) \[skip ci\]$/;

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function isAncestor(ancestor, descendant) {
  const result = spawnSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw new Error(`git merge-base failed: ${result.stderr.trim()}`);
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index++) {
    if (left.parts[index] > right.parts[index]) return -1;
    if (left.parts[index] < right.parts[index]) return 1;
  }
  return 0;
}

function classify(messages) {
  let bump = "patch";
  for (const message of messages) {
    const subject = message.split(/\r?\n/, 1)[0];
    if (/^[a-z][a-z0-9-]*(?:\([^\r\n()]+\))?!:/i.test(subject) ||
        /^BREAKING[ -]CHANGE:\s*\S/im.test(message)) {
      return "major";
    }
    if (/^feat(?:\([^\r\n()]+\))?:/i.test(subject)) bump = "minor";
  }
  return bump;
}

function calculateVersion(revision) {
  if (git("rev-parse", "--is-shallow-repository") !== "false") {
    throw new Error("Complete Git history and all tags are required");
  }
  const head = git("rev-parse", "--verify", `${revision}^{commit}`);
  const tags = git("for-each-ref", "--format=%(refname:strip=2)", "refs/tags")
    .split("\n")
    .filter(Boolean)
    .map((tag) => {
      const match = stableTag.exec(tag);
      return match && { tag, parts: match.slice(1).map(BigInt) };
    })
    .filter(Boolean)
    .sort(compareVersions);

  const previous = tags[0];
  let base = "";
  if (previous) {
    const previousCommit = git("rev-parse", "--verify", `${previous.tag}^{commit}`);
    if (isAncestor(head, previousCommit)) {
      return { head, previousTag: previous.tag, tag: previous.tag, alreadyReleased: true };
    }
    try {
      base = git("merge-base", head, previousCommit);
    } catch (error) {
      throw new Error(`Latest stable tag ${previous.tag} has no common history with ${head}: ${error.message}`);
    }
    if (!base) throw new Error(`Latest stable tag ${previous.tag} has no common history with ${head}`);
  }

  const messages = git("log", "--format=%B%x00", base ? `${base}..${head}` : head)
    .split("\0")
    .map((message) => message.trim())
    .filter(Boolean);
  if (messages.length === 0) throw new Error("No commits found to determine the next release version");

  const bump = classify(messages);
  let manifest;
  try {
    manifest = JSON.parse(git("show", `${head}:package.json`));
  } catch (error) {
    throw new Error(`Cannot read package.json at the tested commit: ${error.message}`);
  }
  const match = typeof manifest?.version === "string" && stableTag.exec(`v${manifest.version}`);
  if (!match) throw new Error("package.json must contain a stable SemVer version");
  const packageParts = match.slice(1).map(BigInt);
  let parts = previous && compareVersions(previous, { parts: packageParts }) < 0
    ? previous.parts : packageParts;
  for (const message of messages) {
    const release = releaseSubject.exec(message.split(/\r?\n/, 1)[0]);
    if (!release) continue;
    const releaseParts = stableTag.exec(release[1]).slice(1).map(BigInt);
    if (compareVersions({ parts: releaseParts }, { parts }) < 0) parts = releaseParts;
  }
  const [major, minor, patch] = parts;
  const version = bump === "major" ? `${major + 1n}.0.0`
    : bump === "minor" ? `${major}.${minor + 1n}.0`
    : `${major}.${minor}.${patch + 1n}`;
  return { head, previousTag: previous ? previous.tag : "", base, bump, version, tag: `v${version}`, alreadyReleased: false };
}

if (require.main === module) {
  try {
    if (process.argv.length !== 3 || !/^[0-9a-f]{40,64}$/i.test(process.argv[2])) {
      throw new Error("Provide the full tested commit SHA");
    }
    const result = calculateVersion(process.argv[2]);
    console.log(JSON.stringify(result));
    if (process.env.GITHUB_OUTPUT) {
      for (const [key, value] of Object.entries(result)) {
        appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
      }
    }
  } catch (error) {
    console.error(`Unable to calculate npm release version: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { calculateVersion, classify };
