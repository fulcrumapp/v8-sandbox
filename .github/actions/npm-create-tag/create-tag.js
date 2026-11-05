"use strict";

const { execFileSync, spawnSync } = require("node:child_process");
const { appendFileSync } = require("node:fs");
const { devNull } = require("node:os");
const { isDeepStrictEqual } = require("node:util");
const { calculateVersion } = require("../npm-next-version/next-version.js");
const { verifyIdentity, verifyRemoteIdentity } = require("../npm-release-identity/identity.js");
const { npmErrorResponse } = require("../npm-common/error-response.js");

const releaseMessage = /^chore\(release\): (v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)) \[skip ci\]$/;
const commitMutation = `
  mutation($input: CreateCommitOnBranchInput!) {
    createCommitOnBranch(input: $input) {
      commit { oid signature { isValid wasSignedByGitHub } }
    }
  }
`;

function command(program, args, input) {
  return execFileSync(program, args, {
    encoding: "utf8",
    input,
    maxBuffer: 16 * 1024 * 1024,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"]
  }).trim();
}

function checkPublicRegistry(name, version, npm) {
  const result = npm("view", name, "versions", "--json",
    "--registry=https://registry.npmjs.org/", "--@fulcrumapp:registry=https://registry.npmjs.org/");
  if (result.status !== 0) {
    const stdout = npmErrorResponse(result.stdout);
    const stderr = npmErrorResponse(result.stderr);
    if ((result.stdout || "").trim() && !stdout) throw new Error("Unable to read npmjs.org versions before tagging");
    if (stdout && stderr && stdout?.error?.code !== stderr?.error?.code) {
      throw new Error("npmjs.org returned conflicting errors");
    }
    const response = stdout || stderr;
    if (result.status === 1 && response?.error?.code === "E404") return;
    throw new Error(`npmjs.org version lookup failed: ${response?.error?.code || result.status}`);
  }
  let versions;
  try {
    versions = JSON.parse(result.stdout || "");
  } catch {
    throw new Error("Unable to read npmjs.org versions before tagging");
  }
  versions = Array.isArray(versions) ? versions : [versions];
  if (!versions.every((item) => typeof item === "string")) {
    throw new Error("npmjs.org returned malformed version data");
  }
  const target = version.split(".").map(BigInt);
  for (const candidate of versions) {
    const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(candidate);
    if (!match) continue;
    const parts = match.slice(1).map(BigInt);
    const comparison = parts.findIndex((part, index) => part !== target[index]);
    if (comparison === -1 || parts[comparison] > target[comparison]) {
      throw new Error(`Planned version ${version} is not newer than published npmjs.org version ${candidate}`);
    }
  }
}

function mainHead(gh, repository) {
  const result = JSON.parse(gh(["api", `repos/${repository}/git/ref/heads/main`]));
  const sha = result.object?.sha;
  if (!/^[0-9a-f]{40}$/i.test(sha || "")) throw new Error("Unable to determine the current main commit");
  return sha;
}

function recoverRelease(options, currentHead) {
  const { head, repository, git, gh } = options;
  const pages = gh([
    "api", "--paginate", `repos/${repository}/compare/${head}...${currentHead}?per_page=100`,
    "--jq", "{base: .merge_base_commit.sha, commits: [.commits[] | {sha, parents: [.parents[] | {sha}], commit: {message: .commit.message}}]}"
  ]).split("\n").filter(Boolean).map((page) => JSON.parse(page));
  if (!pages.length || pages.some((page) => page.base !== head || !Array.isArray(page.commits))) {
    throw new Error("The tested commit is no longer an ancestor of main");
  }
  const commits = new Map(pages.flatMap((page) => page.commits).map((commit) => [commit.sha, commit]));
  let cursor = currentHead;
  let child;
  while (cursor !== head) {
    const commit = commits.get(cursor);
    if (!commit?.parents?.length) throw new Error("Cannot verify the first-parent main history for release recovery");
    if (commit.parents[0].sha === head) child = commit;
    cursor = commit.parents[0].sha;
  }
  if (child?.parents.length !== 1) return null;
  const match = releaseMessage.exec(child.commit?.message || "");
  if (!match) return null;
  if (!/^[0-9a-f]{40}$/i.test(child.sha || "")) throw new Error("Invalid release commit SHA");
  const detail = JSON.parse(gh(["api", `repos/${repository}/commits/${child.sha}`]));
  if (detail.commit?.verification?.verified !== true ||
      detail.parents?.length !== 1 || detail.parents[0].sha !== head ||
      detail.files?.length !== 1 || detail.files[0].filename !== "package.json" ||
      detail.files[0].status !== "modified" || detail.commit.message !== child.commit.message) {
    throw new Error("Cannot recover an unverified or non-version-only release commit");
  }
  verifyRemoteIdentity(gh, repository, child.sha);
  const response = JSON.parse(gh(["api", `repos/${repository}/contents/package.json?ref=${child.sha}`]));
  if (response.encoding !== "base64" || typeof response.content !== "string") {
    throw new Error("Cannot read the release commit package.json");
  }
  const before = JSON.parse(git("show", `${head}:package.json`));
  const after = JSON.parse(Buffer.from(response.content, "base64").toString("utf8"));
  if (after.version !== match[1].slice(1) || before.version === after.version) {
    throw new Error("Recovered release commit has an invalid package version");
  }
  delete before.version;
  delete after.version;
  if (!isDeepStrictEqual(before, after)) throw new Error("Recovered release commit changes more than the package version");
  const tag = match[1];
  const refs = JSON.parse(gh(["api", `repos/${repository}/git/matching-refs/tags/${tag}`]));
  if (!Array.isArray(refs)) throw new Error("Unable to inspect the release tag");
  const existing = refs.find((ref) => ref.ref === `refs/tags/${tag}`);
  if (existing) {
    if (existing.object?.type !== "commit" || existing.object.sha !== child.sha) {
      throw new Error(`Existing ${tag} does not point to the release commit`);
    }
    return { tag, commit: child.sha, alreadyReleased: true };
  }
  const plan = options.calculateVersion(head);
  if (plan.head !== head || plan.alreadyReleased || plan.tag !== tag) {
    throw new Error(`Cannot recover ${tag}: the calculated version does not match`);
  }
  gh(["api", "--method", "POST", `repos/${repository}/git/refs`, "-f", `ref=refs/tags/${tag}`, "-f", `sha=${child.sha}`]);
  return { tag, commit: child.sha, alreadyReleased: false, recovered: true };
}

function createReleaseTag(options) {
  const { head, repository, runId, attempt, eventName, ref, git, gh } = options;
  if (!/^[0-9a-f]{40}$/i.test(head) ||
      !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) ||
      !/^\d+$/.test(runId) || !/^\d+$/.test(attempt) ||
      eventName !== "push" || ref !== "refs/heads/main") {
    throw new Error("Release tagging requires a tested main push and valid GitHub run metadata");
  }

  const currentHead = mainHead(gh, repository);
  if (currentHead !== head) {
    return recoverRelease(options, currentHead) || { superseded: true, alreadyReleased: false };
  }
  const plan = options.calculateVersion(head);
  if (plan.head !== head) throw new Error("Version plan does not match the tested commit");
  if (plan.alreadyReleased) {
    if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(plan.tag || "")) {
      throw new Error("Already-released plan must identify a stable release tag");
    }
    if (git("rev-parse", "--verify", `refs/tags/${plan.tag}^{commit}`) !== head) {
      throw new Error(`Tag ${plan.tag} does not point to the current validated main commit; reconcile the release tag before retrying`);
    }
    return { tag: plan.tag, alreadyReleased: true };
  }
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(plan.version) ||
      plan.tag !== `v${plan.version}`) {
    throw new Error("Version plan does not contain a matching stable SemVer tag");
  }
  const range = plan.base ? `${plan.base}..${head}` : head;
  if (git("log", "--format=%s", range).split("\n").some((subject) => releaseMessage.test(subject))) {
    console.warn("::warning::An earlier release commit may be untagged; this validated release will supersede it.");
  }

  const packageJson = JSON.parse(git("show", `${head}:package.json`));
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(packageJson.version || "") ||
      !/^@fulcrumapp\/[a-z0-9][a-z0-9._-]*$/.test(packageJson.name || "")) {
    throw new Error("package.json must contain a stable version and an @fulcrumapp package name");
  }
  const lockfiles = git("ls-tree", "--name-only", head, "--",
    "yarn.lock", "package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml").split("\n").filter(Boolean);
  if (packageJson.workspaces || lockfiles.length !== 1 || lockfiles[0] !== "yarn.lock") {
    throw new Error("Release tagging supports single-package Yarn classic repositories with one yarn.lock only");
  }
  const previous = packageJson.version.split(".").map(BigInt);
  const next = plan.version.split(".").map(BigInt);
  const difference = next.findIndex((part, index) => part !== previous[index]);
  if (difference === -1 || next[difference] < previous[difference]) {
    throw new Error("The planned version must be newer than the version on main; reconcile tags before releasing");
  }
  if (options.checkPublicRegistry) options.checkPublicRegistry(packageJson.name, plan.version);
  packageJson.version = plan.version;
  const contents = Buffer.from(`${JSON.stringify(packageJson, null, 2)}\n`).toString("base64");
  const endpoint = `repos/${repository}/git/refs`;
  const mutation = {
    query: commitMutation,
    variables: {
      input: {
        branch: { repositoryNameWithOwner: repository, branchName: "main" },
        expectedHeadOid: head,
        message: { headline: `chore(release): ${plan.tag} [skip ci]` },
        fileChanges: { additions: [{ path: "package.json", contents }] }
      }
    }
  };
  let response;
  try {
    response = JSON.parse(gh(["api", "graphql", "--input", "-"], JSON.stringify(mutation)));
    if (response.errors?.length) throw new Error(`GitHub rejected the release commit: ${JSON.stringify(response.errors)}`);
  } catch (error) {
    const latestHead = mainHead(gh, repository);
    if (latestHead !== head) {
      return recoverRelease(options, latestHead) || { superseded: true, alreadyReleased: false };
    }
    throw error;
  }
  const commit = response.data?.createCommitOnBranch?.commit;
  if (!commit || !/^[0-9a-f]{40}$/i.test(commit.oid) || commit.signature?.isValid !== true) {
    throw new Error("GitHub did not return a valid release commit signature; rerun this workflow to investigate");
  }
  verifyIdentity(commit, repository, commit.oid);
  gh(["api", "--method", "POST", endpoint, "-f", `ref=refs/tags/${plan.tag}`, "-f", `sha=${commit.oid}`]);
  return { tag: plan.tag, commit: commit.oid, alreadyReleased: false };
}

if (require.main === module) {
  try {
    const result = createReleaseTag({
      head: process.env.GITHUB_SHA,
      repository: process.env.GITHUB_REPOSITORY,
      runId: process.env.GITHUB_RUN_ID,
      attempt: process.env.GITHUB_RUN_ATTEMPT,
      eventName: process.env.GITHUB_EVENT_NAME,
      ref: process.env.GITHUB_REF,
      git: (...args) => command("git", args),
      gh: (args, input) => command("gh", args, input),
      calculateVersion,
      checkPublicRegistry: process.env.CHECK_NPMJS === "true" ? (name, version) =>
        checkPublicRegistry(name, version, (...args) => {
          const env = { ...process.env, NPM_CONFIG_USERCONFIG: devNull };
          delete env.GH_TOKEN;
          delete env.NODE_AUTH_TOKEN;
          const result = spawnSync("npm", args, { encoding: "utf8", env });
          if (result.error) throw result.error;
          return result;
        }) : undefined
    });
    console.log(JSON.stringify(result));
    if (process.env.GITHUB_OUTPUT) {
      for (const [key, value] of Object.entries(result)) {
        appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
      }
    }
  } catch (error) {
    console.error(`Unable to create npm release tag: ${error.stack || error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { createReleaseTag, checkPublicRegistry };
