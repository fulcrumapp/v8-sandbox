"use strict";

const { execFileSync, spawnSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const { createHash } = require("node:crypto");
const { isDeepStrictEqual } = require("node:util");
const { verifyRemoteIdentity } = require("../npm-release-identity/identity.js");
const { npmErrorResponse } = require("../npm-common/error-response.js");
const { verifyOriginTag } = require("../npm-common/remote-tag.js");

const registry = "https://npm.pkg.github.com/";
const stableTag = /^refs\/tags\/v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function verifyRelease(ref, packageJson, git) {
  const match = stableTag.exec(ref || "");
  if (!match) throw new Error("Publishing requires a stable SemVer tag");
  if (packageJson.version !== match.slice(1).join(".")) {
    throw new Error("The tag and package version must match exactly");
  }
  if (!/^@fulcrumapp\/[a-z0-9][a-z0-9._-]*$/.test(packageJson.name || "")) {
    throw new Error("The package must use the @fulcrumapp scope");
  }
  const commits = git("rev-list", "--parents", "-n", "1", "HEAD").split(/\s+/);
  if (commits.length !== 2) throw new Error("The release commit must have exactly one parent");
  git("merge-base", "--is-ancestor", "HEAD", "refs/remotes/origin/main");
  if (git("show", "-s", "--format=%B", "HEAD") !== `chore(release): v${packageJson.version} [skip ci]`) {
    throw new Error("The release commit message must match the release tag");
  }
  if (git("diff", "--name-only", `${commits[1]}..HEAD`) !== "package.json") {
    throw new Error("The release commit must only change package.json");
  }
  const previous = JSON.parse(git("show", `${commits[1]}:package.json`));
  const current = JSON.parse(git("show", "HEAD:package.json"));
  if (!isDeepStrictEqual(current, packageJson)) throw new Error("The workspace package.json differs from the tagged commit");
  if (previous.version === current.version) throw new Error("The release commit must change the package version");
  delete previous.version;
  const withoutVersion = { ...current };
  delete withoutVersion.version;
  if (!isDeepStrictEqual(previous, withoutVersion)) throw new Error("Only the package version may change in a release commit");
  return packageJson;
}

function verifyCheckout(ref, eventSha, git) {
  if (!stableTag.test(ref || "")) throw new Error("Publishing requires a stable SemVer tag");
  if (!/^[0-9a-f]{40,64}$/.test(eventSha || "") ||
      git("rev-parse", "HEAD") !== eventSha ||
      git("rev-parse", "--verify", `${ref}^{commit}`) !== eventSha) {
    throw new Error("Checked-out tag differs from the triggering revision");
  }
  return eventSha;
}

function publishPackage(packageJson, npm, tarball, verifyTag, integrity = () =>
  `sha512-${createHash("sha512").update(readFileSync(tarball)).digest("base64")}`) {
  if (typeof verifyTag !== "function") throw new Error("Remote tag verification is required");
  const result = npm("view", `${packageJson.name}@${packageJson.version}`, "version", "--json", `--registry=${registry}`);
  if (result.status === 0) {
    let response;
    try {
      response = JSON.parse(result.stdout || "");
    } catch {
      throw new Error("Unable to read the package registry version");
    }
    if (response !== packageJson.version) throw new Error("Package registry returned a mismatched version");
    const stored = npm("view", `${packageJson.name}@${packageJson.version}`, "dist.integrity", "--json", `--registry=${registry}`);
    let storedIntegrity;
    try {
      storedIntegrity = JSON.parse(stored.stdout || "");
    } catch {
      throw new Error("Unable to read existing package registry integrity");
    }
    if (stored.status !== 0 || storedIntegrity !== integrity()) {
      throw new Error("Existing package registry integrity does not match the release tarball");
    }
    verifyTag();
    return "already published";
  }
  const stdoutResponse = npmErrorResponse(result.stdout);
  const stderrResponse = npmErrorResponse(result.stderr);
  if ((result.stdout || "").trim() && !stdoutResponse) {
    throw new Error(`Unable to query the package registry (exit ${result.status})`);
  }
  if (stdoutResponse && stderrResponse && stdoutResponse?.error?.code !== stderrResponse?.error?.code) {
    throw new Error("Package registry returned conflicting errors");
  }
  const response = stdoutResponse || stderrResponse;
  if (!response) throw new Error(`Unable to query the package registry (exit ${result.status})`);
  if (result.status !== 1 || response?.error?.code !== "E404") {
    throw new Error(`Package registry query failed: ${response?.error?.code || result.status}`);
  }
  verifyTag();
  const publish = npm("publish", tarball, "--ignore-scripts", `--registry=${registry}`, `--@fulcrumapp:registry=${registry}`);
  if (publish.status !== 0) throw new Error(`npm publish failed (exit ${publish.status}): ${publish.stderr || ""}`);
  return "published";
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

if (require.main === module) {
  try {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
    verifyRelease(process.env.GITHUB_REF, packageJson, git);
    const tagSha = verifyCheckout(process.env.GITHUB_REF, process.env.GITHUB_SHA, git);
    if (!process.env.GH_TOKEN) throw new Error("GH_TOKEN is required to verify the release commit");
    verifyRemoteIdentity((args, input) => execFileSync("gh", args, {
      encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"]
    }), process.env.GITHUB_REPOSITORY, tagSha);
    if (process.argv[2] === "verify") {
      console.log(`Verified ${packageJson.name}@${packageJson.version}`);
    } else if (process.argv[2] === "publish" && process.argv[3]) {
      const packed = JSON.parse(execFileSync("tar", ["-xOzf", process.argv[3], "package/package.json"], { encoding: "utf8" }));
      if (packed.name !== packageJson.name || packed.version !== packageJson.version) {
        throw new Error("Packed package identity does not match the verified tag");
      }
      if (!process.env.NODE_AUTH_TOKEN) throw new Error("NODE_AUTH_TOKEN is required to publish");
      const npm = (...args) => {
        const result = spawnSync("npm", args, { encoding: "utf8" });
        if (result.error) throw result.error;
        if (result.stderr) result.stderr = result.stderr.split(process.env.NODE_AUTH_TOKEN).join("[REDACTED]");
        return result;
      };
      console.log(`${packageJson.name}@${packageJson.version}: ${publishPackage(
        packageJson, npm, process.argv[3], () => verifyOriginTag(process.env.GITHUB_REF, tagSha)
      )}`);
    } else {
      throw new Error("Expected verify or publish <tarball>");
    }
  } catch (error) {
    console.error(`Unable to publish npm package: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { verifyRelease, verifyCheckout, publishPackage };
