"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createReleaseTag, checkPublicRegistry } = require("../actions/npm-create-tag/create-tag.js");

const head = "a".repeat(40);
const releaseCommit = "b".repeat(40);

function fixture(overrides = {}) {
  const calls = [];
  const git = (...args) => {
    calls.push(["git", ...args]);
    if (args[0] === "show") return '{\n  "name": "@fulcrumapp/example",\n  "version": "0.1.0",\n  "packageManager": "yarn@1.22.22"\n}\n';
    if (args[0] === "ls-tree") return "yarn.lock";
    if (args[0] === "rev-parse") return head;
    return "";
  };
  const gh = (args, input) => {
    calls.push(["gh", args, input]);
    if (args.includes("repos/fulcrumapp/example/git/ref/heads/main")) return JSON.stringify({ object: { sha: head } });
    if (args.includes("graphql")) {
      return JSON.stringify({ data: { createCommitOnBranch: { commit: {
        oid: releaseCommit, author: { user: { databaseId: 278782705 } },
        signature: { isValid: true, wasSignedByGitHub: true }
      } } } });
    }
    return "{}";
  };
  return {
    calls,
    options: {
      head,
      repository: "fulcrumapp/example",
      runId: "123",
      attempt: "1",
      eventName: "push",
      ref: "refs/heads/main",
      git,
      gh,
      calculateVersion: () => ({ head, version: "1.2.3", tag: "v1.2.3", alreadyReleased: false }),
      ...overrides
    }
  };
}

test("creates a signed version commit on main, skips CI, and tags it", () => {
  const { calls, options } = fixture();
  assert.deepEqual(createReleaseTag(options), { tag: "v1.2.3", commit: releaseCommit, alreadyReleased: false });
  const operations = calls.filter((entry) => entry[0] === "gh");
  assert.equal(operations.length, 3);
  const mutation = JSON.parse(operations[1][2]);
  assert.equal(mutation.variables.input.branch.branchName, "main");
  assert.equal(mutation.variables.input.expectedHeadOid, head);
  assert.match(mutation.variables.input.message.headline, /\[skip ci\]/);
  const changes = mutation.variables.input.fileChanges.additions;
  assert.deepEqual(changes.map((item) => item.path), ["package.json"]);
  assert.equal(JSON.parse(Buffer.from(changes[0].contents, "base64")).version, "1.2.3");
  assert.equal(operations[2][1].includes(`sha=${releaseCommit}`), true);
  assert.equal(operations[2][1].includes("ref=refs/tags/v1.2.3"), true);
});

test("does not create refs for an already released commit", () => {
  const { calls, options } = fixture({
    calculateVersion: () => ({ head, tag: "v1.2.3", alreadyReleased: true })
  });
  assert.equal(createReleaseTag(options).alreadyReleased, true);
  assert.equal(calls.some((entry) => entry[1]?.includes("POST")), false);
});

test("does not silently treat an off-main descendant tag as a validated release", () => {
  const calls = [];
  const { options } = fixture({
    calculateVersion: () => ({ head, tag: "v1.2.3", alreadyReleased: true }),
    git: (...args) => {
      calls.push(args);
      if (args.join(" ") === "rev-parse --verify refs/tags/v1.2.3^{commit}") return releaseCommit;
      throw new Error("unexpected git command");
    }
  });
  assert.throws(() => createReleaseTag(options), /does not point to the current validated main commit/);
  assert.equal(calls.length, 1);
});

test("does not tag an unsigned release commit", () => {
  const calls = [];
  const { options } = fixture({
    gh: (args) => {
      calls.push(args);
      if (args.includes("repos/fulcrumapp/example/git/ref/heads/main")) return JSON.stringify({ object: { sha: head } });
      if (args.includes("graphql")) {
        return JSON.stringify({ data: { createCommitOnBranch: { commit: {
          oid: releaseCommit, signature: { isValid: false }
        } } } });
      }
      return "{}";
    }
  });
  assert.throws(() => createReleaseTag(options), /signature/);
  assert.equal(calls.some((args) => args.includes("ref=refs/tags/v1.2.3")), false);
});

test("tags a GitHub-signed release commit regardless of App", () => {
  const calls = [];
  const { options } = fixture({ gh: (args) => {
    calls.push(args);
    if (args.includes("repos/fulcrumapp/example/git/ref/heads/main")) return JSON.stringify({ object: { sha: head } });
    if (args.includes("graphql")) return JSON.stringify({ data: { createCommitOnBranch: { commit: {
      oid: releaseCommit, author: { user: { databaseId: 350331494 } },
      signature: { isValid: true, wasSignedByGitHub: true }
    } } } });
    if (args.includes("POST")) return "{}";
    throw new Error("unexpected request");
  } });
  assert.equal(createReleaseTag(options).tag, "v1.2.3");
  assert.equal(calls.some((args) => args.includes("POST")), true);
});

test("rejects malformed or untrusted release inputs before creating refs", () => {
  for (const overrides of [
    { head: "main" },
    { repository: "fulcrumapp/example/extra" },
    { runId: "1;echo bad" },
    { calculateVersion: () => ({ head, version: "1.2.3", tag: "v1.2.4", alreadyReleased: false }) }
  ]) {
    const { calls, options } = fixture(overrides);
    assert.throws(() => createReleaseTag(options));
    assert.equal(calls.some((entry) => entry[0] === "gh" && (entry[1].includes("POST") || entry[1].includes("graphql"))), false);
  }
});

test("refuses a version at or below an existing stable npmjs.org version", () => {
  assert.throws(() => checkPublicRegistry("@fulcrumapp/example", "2.7.27",
    () => ({ status: 0, stdout: '["2.7.26","3.0.0","9.0.0-rc.1"]' })), /not newer/);
  assert.doesNotThrow(() => checkPublicRegistry("@fulcrumapp/example", "3.0.1",
    () => ({ status: 0, stdout: '["3.0.0","9.0.0-rc.1"]' })));
  assert.doesNotThrow(() => checkPublicRegistry("@fulcrumapp/new", "0.0.1",
    () => ({ status: 1, stdout: '{"error":{"code":"E404"}}' })));
  assert.throws(() => checkPublicRegistry("@fulcrumapp/example", "3.0.1",
    () => ({ status: 1, stdout: '{"error":{"code":"E401"}}' })), /lookup failed/);
});

test("accepts only unambiguous structured E404 responses from either registry stream", () => {
  const e404 = JSON.stringify({ error: { code: "E404" } }, null, 2);
  const e401 = JSON.stringify({ error: { code: "E401" } }, null, 2);
  for (const result of [
    { status: 1, stdout: e404, stderr: "npm error code E404" },
    { status: 1, stdout: "", stderr: `npm error code E404\n${e404}\nnpm error log` },
  ]) {
    assert.doesNotThrow(() => checkPublicRegistry("@fulcrumapp/new", "0.0.1", () => result));
  }
  for (const result of [
    { status: 1, stdout: "malformed", stderr: e404 },
    { status: 1, stdout: e401, stderr: e404 },
    { status: 1, stdout: "", stderr: "npm error code E404" },
    { status: 2, stdout: "", stderr: e404 },
    { status: 1, stdout: "", stderr: e401 },
  ]) {
    assert.throws(() => checkPublicRegistry("@fulcrumapp/new", "0.0.1", () => result));
  }
});

test("checks the public registry before creating any refs", () => {
  const { calls, options } = fixture({ checkPublicRegistry: () => { throw new Error("registry conflict"); } });
  assert.throws(() => createReleaseTag(options), /registry conflict/);
  assert.equal(calls.some((entry) => entry[0] === "gh" && (entry[1].includes("POST") || entry[1].includes("graphql"))), false);
});

test("supersedes a validated commit when main has advanced", () => {
  const calls = [];
  const { options } = fixture({ gh: (args) => {
    calls.push(args);
    if (args.includes("repos/fulcrumapp/example/git/ref/heads/main")) return JSON.stringify({ object: { sha: releaseCommit } });
    if (args.some((arg) => arg.includes("/compare/"))) return JSON.stringify({
      base: head,
      commits: [{ sha: releaseCommit, parents: [{ sha: head }], commit: { message: "feat: another merge" } }]
    });
    throw new Error("unexpected request");
  } });
  assert.deepEqual(createReleaseTag(options), { superseded: true, alreadyReleased: false });
  assert.equal(calls.some((args) => args.includes("graphql") || args.includes("POST")), false);
});

test("recovers a signed version commit when tag creation previously failed", () => {
  const calls = [];
  const message = "chore(release): v1.2.3 [skip ci]";
  const manifest = { name: "@fulcrumapp/example", version: "1.2.3", packageManager: "yarn@1.22.22" };
  const { options } = fixture({ gh: (args) => {
    calls.push(args);
    if (args.includes("repos/fulcrumapp/example/git/ref/heads/main")) return JSON.stringify({ object: { sha: releaseCommit } });
    if (args.some((arg) => arg.includes("/compare/"))) return JSON.stringify({
      base: head,
      commits: [{ sha: releaseCommit, parents: [{ sha: head }], commit: { message } }]
    });
    if (args.includes(`repos/fulcrumapp/example/commits/${releaseCommit}`)) return JSON.stringify({
      author: { type: "Bot" }, parents: [{ sha: head }],
      commit: { message, verification: { verified: true } },
      files: [{ filename: "package.json", status: "modified" }]
    });
    if (args.includes("graphql")) return JSON.stringify({ data: { repository: { object: {
      oid: releaseCommit, author: { user: { databaseId: 278782705 } },
      signature: { isValid: true, wasSignedByGitHub: true }
    } } } });
    if (args.some((arg) => arg.includes("/contents/package.json?"))) return JSON.stringify({
      encoding: "base64", content: Buffer.from(JSON.stringify(manifest)).toString("base64")
    });
    if (args.some((arg) => arg.includes("/git/matching-refs/"))) return "[]";
    if (args.includes("POST")) return "{}";
    throw new Error(`unexpected request: ${args}`);
  } });
  assert.deepEqual(createReleaseTag(options), { tag: "v1.2.3", commit: releaseCommit, alreadyReleased: false, recovered: true });
  assert.equal(calls.filter((args) => args.includes("POST")).length, 1);
  assert.equal(calls.filter((args) => args.includes("graphql")).length, 1);
});

test("does not recover an unsigned release commit", () => {
  for (const [verified, type] of [[false, "Bot"], [false, "User"]]) {
    const calls = [];
    const message = "chore(release): v1.2.3 [skip ci]";
    const { options } = fixture({ gh: (args) => {
      calls.push(args);
      if (args.includes("repos/fulcrumapp/example/git/ref/heads/main")) return JSON.stringify({ object: { sha: releaseCommit } });
      if (args.some((arg) => arg.includes("/compare/"))) return JSON.stringify({
        base: head,
        commits: [{ sha: releaseCommit, parents: [{ sha: head }], commit: { message } }]
      });

      if (args.includes(`repos/fulcrumapp/example/commits/${releaseCommit}`)) return JSON.stringify({
        author: { type }, parents: [{ sha: head }],
        commit: { message, verification: { verified } },
        files: [{ filename: "package.json", status: "modified" }]
      });
      throw new Error("unexpected request");
    } });
    assert.throws(() => createReleaseTag(options), /unverified/);
    assert.equal(calls.some((args) => args.includes("POST")), false);
  }
});

test("recovers a GitHub-signed release commit regardless of author", () => {
  const calls = [];
  const message = "chore(release): v1.2.3 [skip ci]";
  const manifest = { name: "@fulcrumapp/example", version: "1.2.3", packageManager: "yarn@1.22.22" };
  const { options } = fixture({ gh: (args) => {
    calls.push(args);
    if (args.includes("repos/fulcrumapp/example/git/ref/heads/main")) return JSON.stringify({ object: { sha: releaseCommit } });
    if (args.some((arg) => arg.includes("/compare/"))) return JSON.stringify({
      base: head, commits: [{ sha: releaseCommit, parents: [{ sha: head }], commit: { message } }]
    });
    if (args.includes(`repos/fulcrumapp/example/commits/${releaseCommit}`)) return JSON.stringify({
      author: { type: "User" }, parents: [{ sha: head }],
      commit: { message, verification: { verified: true } },
      files: [{ filename: "package.json", status: "modified" }]
    });
    if (args.includes("graphql")) return JSON.stringify({ data: { repository: { object: {
      oid: releaseCommit, author: { user: { databaseId: 350331494 } },
      signature: { isValid: true, wasSignedByGitHub: true }
    } } } });
    if (args.some((arg) => arg.includes("/contents/package.json?"))) return JSON.stringify({
      encoding: "base64", content: Buffer.from(JSON.stringify(manifest)).toString("base64")
    });
    if (args.some((arg) => arg.includes("/git/matching-refs/"))) return "[]";
    if (args.includes("POST")) return "{}";
    throw new Error("unexpected request");
  } });
  assert.equal(createReleaseTag(options).tag, "v1.2.3");
  assert.equal(calls.some((args) => args.includes("POST")), true);
});

test("releases newer validated changes when an earlier release commit has no tag", () => {
  const { options } = fixture({ git: (...args) => {
    if (args[0] === "log") return "chore(release): v1.2.0 [skip ci]";
    if (args[0] === "show") return '{"name":"@fulcrumapp/example","version":"1.2.0","packageManager":"yarn@1.22.22"}';
    if (args[0] === "ls-tree") return "yarn.lock";
    return "";
  } });
  assert.equal(createReleaseTag(options).tag, "v1.2.3");
});

test("requires exactly one Yarn lockfile and no workspaces", () => {
  for (const lockfiles of ["", "package-lock.json", "package-lock.json\nyarn.lock", "npm-shrinkwrap.json"]) {
    const { calls, options } = fixture();
    const git = options.git;
    options.git = (...args) => args[0] === "ls-tree" ? lockfiles : git(...args);
    assert.throws(() => createReleaseTag(options), /single-package Yarn classic repositories/);
    assert.equal(calls.some((entry) => entry[0] === "gh" && entry[1].includes("graphql")), false);
  }
});

test("does not decrease or repeat the current package version", () => {
  for (const version of ["0.1.0", "0.0.9"]) {
    const { options } = fixture({
      calculateVersion: () => ({ head, version, tag: `v${version}`, alreadyReleased: false })
    });
    assert.throws(() => createReleaseTag(options), /must be newer/);
  }
});

test("coalesces a concurrent merge when the expected-head write loses a race", () => {
  let reads = 0;
  const { options } = fixture({ gh: (args) => {
    if (args.includes("repos/fulcrumapp/example/git/ref/heads/main")) {
      return JSON.stringify({ object: { sha: reads++ === 0 ? head : releaseCommit } });
    }
    if (args.includes("graphql")) throw new Error("expected head changed");
    if (args.some((arg) => arg.includes("/compare/"))) return JSON.stringify({
      base: head,
      commits: [{ sha: releaseCommit, parents: [{ sha: head }], commit: { message: "feat: next" } }]
    });
    throw new Error("unexpected request");
  } });
  assert.deepEqual(createReleaseTag(options), { superseded: true, alreadyReleased: false });
});

test("does not recover a release commit on a merged side branch", () => {
  const merge = "c".repeat(40);
  const { options } = fixture({ gh: (args) => {
    if (args.includes("repos/fulcrumapp/example/git/ref/heads/main")) return JSON.stringify({ object: { sha: merge } });
    if (args.some((arg) => arg.includes("/compare/"))) return JSON.stringify({
      base: head,
      commits: [
        { sha: releaseCommit, parents: [{ sha: head }], commit: { message: "chore(release): v1.2.3 [skip ci]" } },
        { sha: merge, parents: [{ sha: head }, { sha: releaseCommit }], commit: { message: "Merge" } }
      ]
    });
    throw new Error("must not recover a side-branch commit");
  } });
  assert.deepEqual(createReleaseTag(options), { superseded: true, alreadyReleased: false });
});

test("follows first-parent history across paginated comparison results", () => {
  const latest = "c".repeat(40);
  const { options } = fixture({ gh: (args) => {
    if (args.includes("repos/fulcrumapp/example/git/ref/heads/main")) return JSON.stringify({ object: { sha: latest } });
    if (args.some((arg) => arg.includes("/compare/"))) {
      assert.ok(args.includes("--paginate"));
      return [
        { base: head, commits: [{ sha: releaseCommit, parents: [{ sha: head }], commit: { message: "feat: first" } }] },
        { base: head, commits: [{ sha: latest, parents: [{ sha: releaseCommit }], commit: { message: "fix: second" } }] }
      ].map(JSON.stringify).join("\n");
    }
    throw new Error("unexpected request");
  } });
  assert.deepEqual(createReleaseTag(options), { superseded: true, alreadyReleased: false });
});
