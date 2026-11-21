import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { describe, it } from 'vitest';

import { Sandbox, SandboxCluster } from '../dist';

const REQUIRE = path.join(__dirname, 'test-functions.js');
const REQUIRE_EXTRA = path.join(__dirname, 'test-functions-extra.js');

describe('v8-sandbox security', () => {
  describe('realm and sandbox escape prevention', () => {
    it('does not expose Node.js runtime globals or module loaders', async () => {
      const sandbox = new Sandbox();
      try {
        const { value, error } = await sandbox.execute({
          code: `
            const forbidden = [
              'process',
              'require',
              'module',
              'exports',
              '__dirname',
              '__filename',
              'Buffer',
              'setImmediate',
              'clearImmediate',
              'setInterval',
              'clearInterval',
              'fetch',
              'queueMicrotask',
              'structuredClone',
            ];
            const found = forbidden.filter((name) => typeof globalThis[name] !== 'undefined');
            setResult({ value: found });
          `,
          timeout: 3000,
        });

        assert.equal(error, undefined);
        assert.deepEqual(value, []);
      } finally {
        await sandbox.shutdown();
      }
    });

    it('blocks Function / AsyncFunction / GeneratorFunction constructor escapes', async () => {
      const sandbox = new Sandbox();
      try {
        const { value, error } = await sandbox.execute({
          code: `
            const AsyncFunction = (async () => {}).constructor;
            const GeneratorFunction = (function* () {}).constructor;
            const probes = [
              this.constructor.constructor('return typeof process')(),
              (() => {}).constructor('return typeof require')(),
              Function('return typeof globalThis.process')(),
              GeneratorFunction('return typeof process')().next().value,
              (async () => AsyncFunction('return typeof process')())(),
            ];
            Promise.all(probes).then((results) => setResult({ value: results }));
          `,
          timeout: 3000,
        });

        assert.equal(error, undefined);
        assert.deepEqual(value, ['undefined', 'undefined', 'undefined', 'undefined', 'undefined']);
      } finally {
        await sandbox.shutdown();
      }
    });

    it('keeps errors thrown across host dispatch inside the sandbox realm', async () => {
      const sandbox = new Sandbox({ timersEnabled: false });
      try {
        const { value, error } = await sandbox.execute({
          code: `
            let caught = null;
            try {
              setTimeout(() => {}, 1);
            } catch (err) {
              caught = {
                isSandboxError: err instanceof Error,
                hasProcess: err.constructor.constructor('return typeof process')(),
                hasRequire: err.constructor.constructor('return typeof require')(),
              };
            }
            setResult({ value: caught });
          `,
          timeout: 3000,
        });

        assert.equal(error, undefined);
        assert.deepEqual(value, {
          isSandboxError: true,
          hasProcess: 'undefined',
          hasRequire: 'undefined',
        });
      } finally {
        await sandbox.shutdown();
      }
    });

    it('keeps injected globals isolated inside the sandbox realm', async () => {
      const sandbox = new Sandbox();
      try {
        const { value, error } = await sandbox.execute({
          code: `
            setResult({
              value: {
                sameObjectCtor: injected.constructor === Object,
                hasProcess: injected.constructor.constructor('return typeof process')(),
              },
            });
          `,
          globals: { injected: { a: 1 } },
          timeout: 3000,
        });

        assert.equal(error, undefined);
        assert.deepEqual(value, {
          sameObjectCtor: true,
          hasProcess: 'undefined',
        });
      } finally {
        await sandbox.shutdown();
      }
    });

    it('blocks host CallSite/Function leakage via Error.prepareStackTrace override', async () => {
      const sandbox = new Sandbox();
      try {
        const { value, error } = await sandbox.execute({
          code: `
            Error.prepareStackTrace = (_err, sites) => {
              return sites.map((s) => ({
                file: s.getFileName ? s.getFileName() : null,
                str: String(s),
              }));
            };
            const stack = new Error('probe').stack;
            setResult({ value: typeof stack === 'string' ? stack : JSON.stringify(stack) });
          `,
          timeout: 3000,
        });

        assert.equal(error, undefined);
        assert.doesNotMatch(value, /worker\.js/);
        assert.doesNotMatch(value, /node:events/);
        assert.doesNotMatch(value, /node:internal/);
      } finally {
        await sandbox.shutdown();
      }
    });
  });

  describe('IPC protocol tampering and prototype pollution defenses', () => {
    it('rejects Object.prototype property names as dispatch methods', async () => {
      const sandbox = new Sandbox({ require: REQUIRE_EXTRA });
      try {
        const { value, error } = await sandbox.execute({
          code: `
            const names = ['constructor', 'toString', 'valueOf', '__proto__', 'hasOwnProperty'];
            const errors = names.map((name) => {
              try {
                dispatch(name, []);
                return 'unexpected-success';
              } catch (err) {
                return err.message;
              }
            });
            setResult({ value: errors });
          `,
          timeout: 3000,
        });

        assert.equal(error, undefined);
        assert.deepEqual(value, [
          'constructor is not a valid method',
          'toString is not a valid method',
          'valueOf is not a valid method',
          '__proto__ is not a valid method',
          'hasOwnProperty is not a valid method',
        ]);
      } finally {
        await sandbox.shutdown();
      }
    });

    it('rejects forged finish() dispatches with arbitrary message IDs', async () => {
      const sandbox = new Sandbox();
      try {
        const { value, error } = await sandbox.execute({
          code: `
            const attempts = [0, 1, -1, 999999, null, '1'].map((id) => {
              const raw = _dispatch('finish', JSON.stringify({ name: 'finish', args: [id] }), null);
              return JSON.parse(raw).result.error.message;
            });
            setResult({ value: attempts });
          `,
          timeout: 3000,
        });

        assert.equal(error, undefined);
        assert.deepEqual(value, [
          'invalid call to finish',
          'invalid call to finish',
          'invalid call to finish',
          'invalid call to finish',
          'invalid call to finish',
          'invalid call to finish',
        ]);
      } finally {
        await sandbox.shutdown();
      }
    });

    it('rejects malformed or non-object JSON payloads sent directly to _dispatch', async () => {
      const sandbox = new Sandbox();
      try {
        const { value, error } = await sandbox.execute({
          code: `
            const payloads = ['not-json', 'null', '123', '"str"', '[]', '{}'];
            const results = payloads.map((payload) => {
              const raw = _dispatch('setResult', payload, null);
              return JSON.parse(raw).result.error?.message ?? 'no-error';
            });
            setResult({ value: results });
          `,
          timeout: 3000,
        });

        assert.equal(error, undefined);
        assert.deepEqual(value, [
          'invalid dispatch',
          'invalid dispatch',
          'invalid dispatch',
          'invalid dispatch',
          'invalid dispatch',
          'undefined is not a valid method',
        ]);
      } finally {
        await sandbox.shutdown();
      }
    });

    it('handles circular references and hostile toJSON/Proxy traps without crashing host', async () => {
      const sandbox = new Sandbox();
      try {
        const circular = await sandbox.execute({
          code: `
            const obj = {};
            obj.self = obj;
            setResult({ value: obj });
          `,
          timeout: 3000,
        });
        assert.match(circular.error?.message || '', /TypeError: Converting circular structure to JSON/);

        const hostile = await sandbox.execute({
          code: `
            setResult({
              value: {
                toJSON() {
                  throw new Error('hostile toJSON');
                },
              },
            });
          `,
          timeout: 3000,
        });
        assert.equal(hostile.error?.message, 'Uncaught Error: hostile toJSON');

        // Verify sandbox remains healthy after hostile serialization attempts
        const ok = await sandbox.execute({
          code: 'setResult({ value: "still-healthy" });',
          timeout: 3000,
        });
        assert.equal(ok.value, 'still-healthy');
      } finally {
        await sandbox.shutdown();
      }
    });

    it('blocks file:// protocol requests via httpRequest', async () => {
      const sandbox = new Sandbox();
      try {
        const { value, error } = await sandbox.execute({
          code: `
            try {
              httpRequest({ url: 'file:///etc/passwd' });
              setResult({ value: 'unexpected-success' });
            } catch (err) {
              setResult({ value: { message: err.message, code: err.code } });
            }
          `,
          timeout: 3000,
        });

        assert.equal(error, undefined);
        assert.notEqual(value, 'unexpected-success');
        assert.match(value.message || '', /protocol|unsupported|adapter/i);
      } finally {
        await sandbox.shutdown();
      }
    });

    it('ignores clearTimeout calls with prototype property names', async () => {
      const sandbox = new Sandbox();
      try {
        const { value, error } = await sandbox.execute({
          code: `
            clearTimeout('constructor');
            clearTimeout('__proto__');
            clearTimeout('toString');
            setTimeout(() => setResult({ value: 'ok' }), 5);
          `,
          timeout: 3000,
        });

        assert.equal(error, undefined);
        assert.equal(value, 'ok');
      } finally {
        await sandbox.shutdown();
      }
    });
  });

  describe('information disclosure prevention', () => {
    it('does not leak host file paths in uncaught errors across sync, callback, and eval', async () => {
      const sandbox = new Sandbox({ debug: false });
      try {
        const cases = [
          'throw new Error("sync-err");',
          'setTimeout(() => { throw new Error("timer-err"); }, 1);',
          'eval("throw new Error(\'eval-err\')");',
          'new Function("throw new Error(\'fn-err\')")();',
          '{{{',
        ];

        for (const code of cases) {
          const { error } = await sandbox.execute({ code, timeout: 3000 });
          assert.ok(error, `Expected error for: ${code}`);
          assert.doesNotMatch(error.stack || '', /worker\.js/);
          assert.doesNotMatch(error.stack || '', /node:events/);
          assert.doesNotMatch(error.stack || '', /node:internal/);
          assert.doesNotMatch(error.stack || '', new RegExp(process.cwd().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        }
      } finally {
        await sandbox.shutdown();
      }
    });

    it('does not leak host stack traces from async host errors when debug is false', async () => {
      const sandbox = new Sandbox({ require: REQUIRE, debug: false });
      try {
        const { error } = await sandbox.execute({
          code: `
            errorAsyncCallbackWithRespond('secret-check', (err) => {
              setResult({ error: err });
            });
          `,
          timeout: 3000,
        });

        assert.ok(error);
        assert.equal(error.message, 'secret-check');
        assert.equal(error.stack, undefined);
      } finally {
        await sandbox.shutdown();
      }
    });
  });

  describe('denial-of-service and resource exhaustion resilience', () => {
    it('recovers cleanly even after an initialization timeout', async () => {
      const sandbox = new Sandbox();
      try {
        const initTimeout = await sandbox.execute({
          code: 'setResult({ value: "first" });',
          timeout: 1,
        });
        assert.equal(initTimeout.error?.isTimeout, true);

        const recovered = await sandbox.execute({
          code: 'setResult({ value: "recovered" });',
          timeout: 3000,
        });
        assert.equal(recovered.error, undefined);
        assert.equal(recovered.value, 'recovered');
      } finally {
        await sandbox.shutdown();
      }
    });

    it('terminates infinite microtask loops via timeout and recovers', async () => {
      const sandbox = new Sandbox();
      try {
        await sandbox.initialize({ timeout: 3000 });
        const timedOut = await sandbox.execute({
          code: `
            function spin() {
              Promise.resolve().then(spin);
            }
            spin();
          `,
          timeout: 150,
        });
        assert.equal(timedOut.error?.isTimeout, true);

        const recovered = await sandbox.execute({
          code: 'setResult({ value: "ok" });',
          timeout: 3000,
        });
        assert.equal(recovered.error, undefined);
        assert.equal(recovered.value, 'ok');
      } finally {
        await sandbox.shutdown();
      }
    });

    it('terminates catastrophic regex backtracking (ReDoS) via timeout and recovers', async () => {
      const sandbox = new Sandbox();
      try {
        await sandbox.initialize({ timeout: 3000 });
        const timedOut = await sandbox.execute({
          code: `
            const re = /^(a+)+$/;
            setResult({ value: re.test('a'.repeat(35) + '!') });
          `,
          timeout: 150,
        });
        assert.equal(timedOut.error?.isTimeout, true);

        const recovered = await sandbox.execute({
          code: 'setResult({ value: "ok" });',
          timeout: 3000,
        });
        assert.equal(recovered.error, undefined);
        assert.equal(recovered.value, 'ok');
      } finally {
        await sandbox.shutdown();
      }
    });

    it('terminates timer bombs via timeout and cleans up host timers', async () => {
      const sandbox = new Sandbox();
      try {
        await sandbox.initialize({ timeout: 3000 });
        const timedOut = await sandbox.execute({
          code: `
            for (let i = 0; i < 200; i++) {
              setTimeout(() => {}, 60000);
            }
          `,
          timeout: 150,
        });
        assert.equal(timedOut.error?.isTimeout, true);
        assert.equal(Object.keys(sandbox.functions.timers).length, 0);

        const recovered = await sandbox.execute({
          code: 'setResult({ value: "clean" });',
          timeout: 3000,
        });
        assert.equal(recovered.error, undefined);
        assert.equal(recovered.value, 'clean');
      } finally {
        await sandbox.shutdown();
      }
    });

    it('isolates global/prototype tampering and tenant data across multi-worker cluster executions', async () => {
      const cluster = new SandboxCluster({ workers: 2 });
      try {
        await cluster.execute({
          code: `
            Object.prototype.leaked = 'secret';
            Array.prototype.leaked = 'secret';
            String.prototype.leaked = 'secret';
            global.tenantSecret = 'tenant-A';
            setResult({ value: true });
          `,
          globals: { secretToken: 'token-A' },
          timeout: 3000,
        });

        const checks = await Promise.all([1, 2, 3, 4].map(() => cluster.execute({
          code: `
            setResult({
              value: {
                obj: ({}).leaked ?? null,
                arr: ([]).leaked ?? null,
                str: ('').leaked ?? null,
                tenantSecret: typeof global.tenantSecret,
                secretToken: typeof global.secretToken,
              },
            });
          `,
          timeout: 3000,
        })));

        for (const res of checks) {
          assert.equal(res.error, undefined);
          assert.deepEqual(res.value, {
            obj: null,
            arr: null,
            str: null,
            tenantSecret: 'undefined',
            secretToken: 'undefined',
          });
        }
      } finally {
        cluster.shutdown();
      }
    });
  });

  describe('security review regressions (findings #1-#10)', () => {
    it('#1: concurrent execute() on a single Sandbox isolates V8 context, globals, prototypes, and results', async () => {
      const sandbox = new Sandbox();
      try {
        const [resA, resB] = await Promise.all([
          sandbox.execute({
            globals: { apiKeyA: 'sk-live-secret-A' },
            code: `
              global.leakedFromA = 'SUPER_SECRET';
              Object.prototype.pollutedByA = 'pwned';
              setTimeout(() => setResult({ value: 'done-A' }), 40);
            `,
            timeout: 3000,
          }),
          sandbox.execute({
            code: `
              setResult({
                value: {
                  leakedFromA: typeof global.leakedFromA,
                  apiKeyA: typeof global.apiKeyA,
                  pollutedByA: ({}).pollutedByA ?? null,
                },
              });
            `,
            timeout: 3000,
          }),
        ]);

        assert.equal(resA.error, undefined);
        assert.equal(resA.value, 'done-A');
        assert.equal(resB.error, undefined);
        assert.deepEqual(resB.value, {
          leakedFromA: 'undefined',
          apiKeyA: 'undefined',
          pollutedByA: null,
        });

        // Also ensure a subsequent call that does NOT call setResult never receives A's result
        const [first, second] = await Promise.all([
          sandbox.execute({ code: 'setResult({ value: "sentinel-1" });', timeout: 3000 }),
          sandbox.execute({ code: '1 + 1;', timeout: 3000 }),
        ]);
        assert.equal(first.value, 'sentinel-1');
        assert.equal(second.value, undefined);
      } finally {
        await sandbox.shutdown();
      }
    });

    it('#2: stale context callbacks via Atomics.waitAsync cannot hijack later executions or steal context', async () => {
      const sandbox = new Sandbox({ require: REQUIRE_EXTRA });
      try {
        const resA = await sandbox.execute({
          code: `
            const sab = new SharedArrayBuffer(4);
            const i32 = new Int32Array(sab);
            Atomics.waitAsync(i32, 0, 0, 120).value.then(() => {
              const stolen = echoContextDelayed(0);
              console.log('leaked-from-A');
              setResult({ value: { hijackedBy: 'A', stolen } });
            });
            setResult({ value: 'A' });
          `,
          context: { tenant: 'A' },
          timeout: 3000,
        });
        assert.equal(resA.value, 'A');

        const resB = await sandbox.execute({
          code: `
            setResult({ value: 'B' });
            setTimeout(() => {}, 300);
          `,
          context: { tenant: 'B', apiToken: 'secret-B-token' },
          timeout: 3000,
        });

        assert.equal(resB.error, undefined);
        assert.equal(resB.value, 'B');
        assert.equal(resB.output?.some((o) => o.message.includes('leaked-from-A')), false);
      } finally {
        await sandbox.shutdown();
      }
    });

    it('#3: setTimeout(null, 1) does not crash the host process', async () => {
      const sandbox = new Sandbox();
      try {
        const { value, error } = await sandbox.execute({
          code: `
            const errors = [];
            for (const bad of [null, undefined, 'code', 123]) {
              try {
                setTimeout(bad, 1);
                errors.push('no-error');
              } catch (err) {
                errors.push(err.message);
              }
            }
            setTimeout(() => setResult({ value: errors }), 20);
          `,
          timeout: 3000,
        });

        assert.equal(error, undefined);
        assert.deepEqual(value, [
          'callback must be a function',
          'callback must be a function',
          'callback must be a function',
          'callback must be a function',
        ]);
      } finally {
        await sandbox.shutdown();
      }
    });

    it('#4: native addon callback/cancel with unknown callbackId does not abort', () => {
      const nativePath = path.join(__dirname, '..', 'build', 'Release', 'sandbox.node');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Sandbox: NativeSandbox } = require(nativePath);
      const native = new NativeSandbox('/tmp/unused-native-test.sock');
      native.initialize();
      assert.doesNotThrow(() => {
        native.callback(1, 99999, '[]');
        native.cancel(1, 99999);
      });
    });

    it('#6: default UNIX socket is created in a private 0700 directory and rejects extra connections', async () => {
      if (process.platform === 'win32') return;
      const sandbox = new Sandbox();
      try {
        const { value, error } = await sandbox.execute({
          code: 'setResult({ value: 1 });',
          timeout: 3000,
        });
        assert.equal(error, undefined);
        assert.equal(value, 1);

        const dirStat = fs.statSync(path.dirname(sandbox.socketName));
        assert.equal(dirStat.mode & 0o777, 0o700);

        // An extra unauthenticated client connecting and writing 1 byte must NOT hijack or crash the host
        const rogue = net.createConnection(sandbox.socketName);
        await new Promise<void>((resolve) => {
          rogue.on('close', () => resolve());
          rogue.on('error', () => resolve());
          rogue.write(Buffer.from([0x01]));
        });

        const after = await sandbox.execute({
          code: 'setResult({ value: 2 });',
          timeout: 3000,
        });
        assert.equal(after.error, undefined);
        assert.equal(after.value, 2);
      } finally {
        await sandbox.shutdown();
      }
    });

    it('#7: httpRequest ignores sandbox proxy override and rejects responseType stream without deadlocking', async () => {
      const secretServer = http.createServer((_req, res) => {
        res.end('internal-secret');
      });
      await new Promise<void>((resolve) => secretServer.listen(0, '127.0.0.1', () => resolve()));
      const addr = secretServer.address() as net.AddressInfo;

      const sandbox = new Sandbox();
      try {
        const proxyAttempt = await sandbox.execute({
          code: `
            try {
              const res = httpRequest({
                url: 'http://example.invalid/meta',
                proxy: { protocol: 'http', host: '127.0.0.1', port: ${addr.port} },
                timeout: 500,
              });
              setResult({ value: res.body });
            } catch (err) {
              setResult({ value: { blocked: true, message: err.message } });
            }
          `,
          timeout: 3000,
        });
        assert.equal(proxyAttempt.error, undefined);
        assert.notEqual(proxyAttempt.value, 'internal-secret');
        assert.equal(proxyAttempt.value.blocked, true);

        const streamAttempt = await sandbox.execute({
          code: `
            try {
              httpRequest({
                url: 'http://127.0.0.1:${addr.port}/',
                responseType: 'stream',
              });
              setResult({ value: 'unexpected-success' });
            } catch (err) {
              setResult({ value: { rejected: true, message: err.message } });
            }
          `,
          timeout: 3000,
        });
        assert.equal(streamAttempt.error, undefined);
        assert.equal(streamAttempt.value.rejected, true);
      } finally {
        await sandbox.shutdown();
        await new Promise<void>((resolve) => secretServer.close(() => resolve()));
      }
    });

    it('#8: throwing non-JSON-serializable values or polluted Object.prototype setters does not abort worker or leak host paths', async () => {
      const sandbox = new Sandbox({ debug: false });
      try {
        const cases = [
          'throw 1n;',
          'const o = {}; o.self = o; throw o;',
          'throw { toJSON() { throw new Error("boom"); } };',
          'Object.defineProperty(Object.prototype, "error", { set() { throw new Error("trap"); } }); throw new Error("trigger");',
        ];

        for (const code of cases) {
          const { error } = await sandbox.execute({ code, timeout: 3000 });
          assert.ok(error, `Expected error for: ${code}`);
          assert.notEqual(error.message, 'worker exited', `Worker aborted on: ${code}`);
          assert.doesNotMatch(error.stack || '', /worker\.js/);
          assert.doesNotMatch(error.stack || '', new RegExp(process.cwd().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        }

        const recovered = await sandbox.execute({
          code: 'setResult({ value: "alive" });',
          timeout: 3000,
        });
        assert.equal(recovered.value, 'alive');
      } finally {
        await sandbox.shutdown();
      }
    });

    it('#9: globals cannot pollute Object.prototype via __proto__ or overwrite core runtime functions', async () => {
      const sandbox = new Sandbox();
      try {
        const maliciousGlobals = JSON.parse('{"__proto__":{"polluted":true},"setResult":null,"_dispatch":null,"safe":"ok"}');
        const { value, error } = await sandbox.execute({
          code: `
            setResult({
              value: {
                polluted: ({}).polluted ?? null,
                safe,
                hasSetResult: typeof setResult === 'function',
              },
            });
          `,
          globals: maliciousGlobals,
          timeout: 3000,
        });

        assert.equal(error, undefined);
        assert.deepEqual(value, {
          polluted: null,
          safe: 'ok',
          hasSetResult: true,
        });
      } finally {
        await sandbox.shutdown();
      }
    });

    it('#10: deferred Promise microtasks format Error.stack under sandbox filter and do not leak host paths', async () => {
      const sandbox = new Sandbox();
      try {
        const { value, error } = await sandbox.execute({
          code: `
            const err = new Error('deferred-probe');
            Promise.resolve().then(() => {
              setResult({ value: err.stack });
            });
          `,
          timeout: 3000,
        });

        assert.equal(error, undefined);
        assert.equal(typeof value, 'string');
        assert.match(value, /Error: deferred-probe/);
        assert.doesNotMatch(value, /worker\.js/);
        assert.doesNotMatch(value, /node:events/);
        assert.doesNotMatch(value, /node:internal/);
      } finally {
        await sandbox.shutdown();
      }
    });
  });
});
