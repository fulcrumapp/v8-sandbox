import assert from 'node:assert/strict';
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
});
