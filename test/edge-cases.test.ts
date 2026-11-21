import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { describe, it, beforeAll, afterAll } from 'vitest';

import { Sandbox, SandboxCluster } from '../dist';

const REQUIRE_EXTRA = path.join(__dirname, 'test-functions-extra.js');
const BINARY_FILE = fs.readFileSync(path.join(__dirname, 'test.jpg'));

describe('v8-sandbox edge cases & isolation', () => {
  let baseUrl: string;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');

    if (url.pathname === '/echo') {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({
          method: req.method,
          query: Object.fromEntries(url.searchParams.entries()),
          headers: req.headers,
          body,
        }));
      });
    } else if (url.pathname === '/status/404') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    } else if (url.pathname === '/status/500') {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('internal server error');
    } else if (url.pathname === '/slow') {
      setTimeout(() => {
        res.end('eventually');
      }, 400);
    } else if (url.pathname === '/binary') {
      res.setHeader('content-type', 'image/jpeg');
      res.end(BINARY_FILE);
    } else {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
    }
  });

  beforeAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', reject);
        const address = server.address();
        if (!address || typeof address === 'string') {
          reject(new Error('HTTP fixture server did not expose a TCP address'));
          return;
        }
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (server.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });

  describe('security and context isolation', () => {
    it('does not expose Node.js globals inside the sandbox', async () => {
      const sandbox = new Sandbox();
      try {
        const { value, error } = await sandbox.execute({
          code: `
            setResult({
              value: {
                process: typeof process,
                require: typeof require,
                Buffer: typeof Buffer,
                __dirname: typeof __dirname,
                __filename: typeof __filename,
                module: typeof module,
                exports: typeof exports,
              },
            });
          `,
          timeout: 3000,
        });

        assert.equal(error, undefined);
        assert.deepEqual(value, {
          process: 'undefined',
          require: 'undefined',
          Buffer: 'undefined',
          __dirname: 'undefined',
          __filename: 'undefined',
          module: 'undefined',
          exports: 'undefined',
        });
      } finally {
        await sandbox.shutdown();
      }
    });

    it('prevents Function constructor escape to host globals', async () => {
      const sandbox = new Sandbox();
      try {
        const { value, error } = await sandbox.execute({
          code: `
            const hostProcess = this.constructor.constructor('return typeof process')();
            const fnRequire = Function('return typeof require')();
            setResult({ value: { hostProcess, fnRequire } });
          `,
          timeout: 3000,
        });

        assert.equal(error, undefined);
        assert.deepEqual(value, { hostProcess: 'undefined', fnRequire: 'undefined' });
      } finally {
        await sandbox.shutdown();
      }
    });

    it('never leaks host paths in Error.stack inspected inside the sandbox', async () => {
      const sandbox = new Sandbox();
      try {
        const { value, error } = await sandbox.execute({
          code: `
            function inner() {
              return new Error('boom').stack;
            }
            setResult({ value: inner() });
          `,
          timeout: 3000,
        });

        assert.equal(error, undefined);
        assert.match(value, /Error: boom/);
        assert.match(value, /at inner \(script:/);
        assert.doesNotMatch(value, /worker\.js/);
        assert.doesNotMatch(value, /node:events/);
        assert.doesNotMatch(value, /node:internal/);
      } finally {
        await sandbox.shutdown();
      }
    });

    it('preserves eval frames without leaking host frames', async () => {
      const sandbox = new Sandbox();
      try {
        const { error } = await sandbox.execute({
          code: `eval('throw new Error("from eval")');`,
          timeout: 3000,
        });

        assert.ok(error);
        assert.equal(error.message, 'Uncaught Error: from eval');
        assert.match(error.stack, /eval/);
        assert.doesNotMatch(error.stack, /worker\.js/);
        assert.doesNotMatch(error.stack, /node:internal/);
      } finally {
        await sandbox.shutdown();
      }
    });

    it('isolates prototype pollution across executions', async () => {
      const sandbox = new Sandbox();
      try {
        const first = await sandbox.execute({
          code: `
            Object.prototype.polluted = 'yes';
            Array.prototype.polluted = 'yes';
            setResult({ value: ({}).polluted });
          `,
          timeout: 3000,
        });
        assert.equal(first.value, 'yes');

        const second = await sandbox.execute({
          code: `
            setResult({
              value: {
                obj: ({}).polluted ?? null,
                arr: ([]).polluted ?? null,
              },
            });
          `,
          timeout: 3000,
        });
        assert.deepEqual(second.value, { obj: null, arr: null });
      } finally {
        await sandbox.shutdown();
      }
    });

    it('gates info() behind debug mode', async () => {
      const sandbox = new Sandbox({ debug: false });
      try {
        const denied = await sandbox.execute({
          code: 'setResult({ value: info() });',
          timeout: 3000,
        });
        assert.equal(denied.error?.message, 'Uncaught Error: info is disabled');

        sandbox.debug = true;
        const allowed = await sandbox.execute({
          code: 'setResult({ value: info() });',
          timeout: 3000,
        });
        assert.equal(allowed.error, undefined);
        assert.equal(allowed.value.versions.v8, process.versions.v8);
      } finally {
        await sandbox.shutdown();
      }
    });

    it('returns a host error for unknown dispatch methods', async () => {
      const sandbox = new Sandbox();
      try {
        const { error } = await sandbox.execute({
          code: `dispatch('doesNotExist', []);`,
          timeout: 3000,
        });
        assert.equal(error?.message, 'Uncaught Error: doesNotExist is not a valid method');
      } finally {
        await sandbox.shutdown();
      }
    });

    it('handles stack overflow (deep recursion) cleanly and recovers', async () => {
      const sandbox = new Sandbox();
      try {
        const overflow = await sandbox.execute({
          code: 'function f() { return f(); } f();',
          timeout: 3000,
        });
        assert.match(overflow.error?.message || '', /RangeError: Maximum call stack size exceeded/);

        const recovered = await sandbox.execute({
          code: 'setResult({ value: "recovered" });',
          timeout: 3000,
        });
        assert.equal(recovered.value, 'recovered');
      } finally {
        await sandbox.shutdown();
      }
    });
  });

  describe('multi-worker SandboxCluster', () => {
    it('executes work concurrently across multiple workers', async () => {
      const cluster = new SandboxCluster({ workers: 3 });
      try {
        // Warm up workers with quick health checks
        await Promise.all([1, 2, 3].map(() => cluster.execute({
          code: 'setResult({ value: 1 });',
          timeout: 3000,
        })));

        const start = Date.now();
        const results = await Promise.all([1, 2, 3].map((n) => cluster.execute({
          code: `setTimeout(() => setResult({ value: ${n} }), 150);`,
          timeout: 3000,
        })));
        const elapsed = Date.now() - start;

        assert.deepEqual(results.map((r) => r.value), [1, 2, 3]);
        // 3 x 150ms tasks running across 3 workers should complete well under 450ms
        assert.ok(elapsed < 400, `Expected parallel execution (<400ms), took ${elapsed}ms`);
      } finally {
        cluster.shutdown();
      }
    });

    it('isolates globals, template mutations, and context across concurrent workers', async () => {
      const cluster = new SandboxCluster({
        workers: 3,
        require: REQUIRE_EXTRA,
        template: 'global.sharedCounter = 0; global.increment = () => ++global.sharedCounter;',
      });

      try {
        const tasks = Array.from({ length: 12 }, (_, i) => cluster.execute({
          code: `
            const count = increment();
            const ctx = echoContextDelayed(${(i % 3) * 10 + 5});
            setResult({ value: { count, id: globalId, ctxId: ctx.id } });
          `,
          globals: { globalId: i },
          context: { id: `ctx-${i}` },
          timeout: 5000,
        }));

        const results = await Promise.all(tasks);
        for (let i = 0; i < results.length; i += 1) {
          assert.equal(results[i].error, undefined);
          assert.deepEqual(results[i].value, {
            count: 1,
            id: i,
            ctxId: `ctx-${i}`,
          });
        }
      } finally {
        cluster.shutdown();
      }
    });

    it('recovers cleanly when some workers time out in a multi-worker cluster', async () => {
      const cluster = new SandboxCluster({ workers: 2 });
      try {
        const [timeout1, timeout2, ok1, ok2] = await Promise.all([
          cluster.execute({ code: 'while (true) {}', timeout: 80 }),
          cluster.execute({ code: 'while (true) {}', timeout: 80 }),
          cluster.execute({ code: 'setResult({ value: "a" });', timeout: 3000 }),
          cluster.execute({ code: 'setResult({ value: "b" });', timeout: 3000 }),
        ]);

        assert.equal(timeout1.error?.isTimeout, true);
        assert.equal(timeout2.error?.isTimeout, true);
        assert.equal(ok1.value, 'a');
        assert.equal(ok2.value, 'b');

        // Verify cluster remains healthy with full worker capacity
        const health = await Promise.all([1, 2, 3, 4].map((n) => cluster.execute({
          code: `setResult({ value: ${n} });`,
          timeout: 3000,
        })));
        assert.deepEqual(health.map((r) => r.value), [1, 2, 3, 4]);
      } finally {
        cluster.shutdown();
      }
    });

    it('handles repeated shutdown() calls safely', () => {
      const cluster = new SandboxCluster({ workers: 2 });
      cluster.shutdown();
      cluster.shutdown();
      assert.equal(cluster.activeWorkers.length, 0);
      assert.equal(cluster.inactiveWorkers.length, 0);
    });
  });

  describe('custom host functions and error shapes', () => {
    it('supports falsy, null, undefined, nested, and Unicode return values', async () => {
      const cluster = new SandboxCluster({ require: REQUIRE_EXTRA });
      try {
        const { value, error } = await cluster.execute({
          code: `
            setResult({
              value: {
                zero: echoValue(0),
                boolFalse: echoValue(false),
                emptyStr: echoValue(''),
                nullVal: echoValue(null),
                undefVal: echoValue(undefined),
                unicode: echoValue('こんにちは 🌍 café résumé'),
                args: echoArgs(1, 'two', { three: [3] }),
              },
            });
          `,
          timeout: 3000,
        });

        assert.equal(error, undefined);
        assert.deepEqual(value, {
          zero: 0,
          boolFalse: false,
          emptyStr: '',
          nullVal: null,
          undefVal: null,
          unicode: 'こんにちは 🌍 café résumé',
          args: [1, 'two', { three: [3] }],
        });
      } finally {
        cluster.shutdown();
      }
    });

    it('propagates plain-object fail() payloads from sync host functions', async () => {
      const cluster = new SandboxCluster({ require: REQUIRE_EXTRA });
      try {
        const { value, error } = await cluster.execute({
          code: `
            try {
              failWithObject({ code: 'E_CUSTOM', message: 'custom failure', detail: 42 });
            } catch (err) {
              setResult({ value: { message: err.message, code: err.code, detail: err.detail, isHost: err.isHost } });
            }
          `,
          timeout: 3000,
        });

        assert.equal(error, undefined);
        assert.deepEqual(value, {
          message: 'custom failure',
          code: 'E_CUSTOM',
          detail: 42,
          isHost: true,
        });
      } finally {
        cluster.shutdown();
      }
    });

    it('passes plain-object errors and context cleanly through defineAsync callbacks', async () => {
      const cluster = new SandboxCluster({ require: REQUIRE_EXTRA });
      try {
        const ok = await cluster.execute({
          code: `
            asyncEchoContext(10, 'hello', (err, data) => {
              setResult({ value: { err, data } });
            });
          `,
          context: { tenant: 'alpha', count: 7 },
          timeout: 3000,
        });
        assert.equal(ok.error, undefined);
        assert.deepEqual(ok.value, {
          err: null,
          data: { label: 'hello', context: { tenant: 'alpha', count: 7 } },
        });

        const failed = await cluster.execute({
          code: `
            asyncFailObject({ code: 'E_ASYNC', message: 'async boom' }, (err) => {
              setResult({ value: err });
            });
          `,
          timeout: 3000,
        });
        assert.equal(failed.error, undefined);
        assert.deepEqual(failed.value, { code: 'E_ASYNC', message: 'async boom' });
      } finally {
        cluster.shutdown();
      }
    });

    it('preserves all arguments when a defineAsync function is called without a trailing callback', async () => {
      const cluster = new SandboxCluster({ require: REQUIRE_EXTRA });
      try {
        const syncCall = await cluster.execute({
          code: 'setResult({ value: asyncOrSyncSum(10, 20, 30) });',
          timeout: 3000,
        });
        assert.equal(syncCall.error, undefined);
        assert.equal(syncCall.value, 60);

        const callbackCall = await cluster.execute({
          code: 'asyncOrSyncSum(10, 20, 30, (err, sum) => setResult({ value: { err, sum } }));',
          timeout: 3000,
        });
        assert.equal(callbackCall.error, undefined);
        assert.deepEqual(callbackCall.value, { err: null, sum: 60 });
      } finally {
        cluster.shutdown();
      }
    });
  });

  describe('HTTP requests and hooks', () => {
    it('supports POST with JSON data, custom headers, query params, and url alias', async () => {
      const sandbox = new Sandbox();
      try {
        const { value, error } = await sandbox.execute({
          code: `
            const res = httpRequest({
              url: '${baseUrl}/echo',
              method: 'POST',
              headers: { 'x-custom': 'hello' },
              params: { foo: 'bar', num: '42' },
              data: { greeting: 'こんにちは' },
            });
            setResult({ value: { statusCode: res.statusCode, body: res.body } });
          `,
          timeout: 3000,
        });

        assert.equal(error, undefined);
        assert.equal(value.statusCode, 200);
        assert.equal(value.body.method, 'POST');
        assert.deepEqual(value.body.query, { foo: 'bar', num: '42' });
        assert.equal(value.body.headers['x-custom'], 'hello');
        assert.deepEqual(JSON.parse(value.body.body), { greeting: 'こんにちは' });
      } finally {
        await sandbox.shutdown();
      }
    });

    it('supports encoding: null for base64 binary responses', async () => {
      const sandbox = new Sandbox();
      try {
        const { value, error } = await sandbox.execute({
          code: `
            const res = httpRequest({ uri: '${baseUrl}/binary', encoding: null });
            setResult({ value: res.body });
          `,
          timeout: 3000,
        });

        assert.equal(error, undefined);
        assert.equal(Buffer.compare(Buffer.from(value, 'base64'), BINARY_FILE), 0);
      } finally {
        await sandbox.shutdown();
      }
    });

    it('surfaces non-2xx HTTP errors cleanly for both sync and async calls', async () => {
      const sandbox = new Sandbox();
      try {
        const syncRes = await sandbox.execute({
          code: `
            try {
              httpRequest({ url: '${baseUrl}/status/404' });
            } catch (err) {
              setResult({ value: { message: err.message, code: err.code } });
            }
          `,
          timeout: 3000,
        });
        assert.equal(syncRes.error, undefined);
        assert.match(syncRes.value.message, /404/);

        const asyncRes = await sandbox.execute({
          code: `
            httpRequest({ url: '${baseUrl}/status/500' }, (err) => {
              setResult({ value: { message: err.message, code: err.code } });
            });
          `,
          timeout: 3000,
        });
        assert.equal(asyncRes.error, undefined);
        assert.match(asyncRes.value.message, /500/);
      } finally {
        await sandbox.shutdown();
      }
    });

    it('respects per-request HTTP timeout without hanging the sandbox', async () => {
      const sandbox = new Sandbox();
      try {
        const { value, error } = await sandbox.execute({
          code: `
            httpRequest({ url: '${baseUrl}/slow', timeout: 50 }, (err) => {
              setResult({ value: { message: err.message, code: err.code } });
            });
          `,
          timeout: 3000,
        });
        assert.equal(error, undefined);
        assert.match(value.message, /timeout/i);
      } finally {
        await sandbox.shutdown();
      }
    });

    it('invokes handleHttpRequest, handleHttpResponse, and handleHttpError hooks with context', async () => {
      const sandbox = new Sandbox({ require: REQUIRE_EXTRA });
      try {
        const ok = await sandbox.execute({
          code: `
            const res = httpRequest({ url: '${baseUrl}/echo' });
            setResult({
              value: {
                injected: res.body.headers['x-injected-context'],
                tagged: res.headers['x-tagged-by-hook'],
              },
            });
          `,
          context: { injectHeader: 'from-ctx', tagResponse: 'resp-tag' },
          timeout: 3000,
        });
        assert.equal(ok.error, undefined);
        assert.deepEqual(ok.value, { injected: 'from-ctx', tagged: 'resp-tag' });

        const failed = await sandbox.execute({
          code: `
            httpRequest({ url: '${baseUrl}/status/500' }, (err) => {
              setResult({ value: err.code });
            });
          `,
          context: { tagError: 'CUSTOM_ERR_TAG' },
          timeout: 3000,
        });
        assert.equal(failed.error, undefined);
        assert.equal(failed.value, 'CUSTOM_ERR_TAG');
      } finally {
        await sandbox.shutdown();
      }
    });

    it('fails async httpRequest when httpEnabled is false', async () => {
      const sandbox = new Sandbox({ httpEnabled: false });
      try {
        const { error } = await sandbox.execute({
          code: `httpRequest({ url: '${baseUrl}/echo' }, () => {});`,
          timeout: 3000,
        });
        assert.equal(error?.message, 'Uncaught Error: httpRequest is disabled');
      } finally {
        await sandbox.shutdown();
      }
    });
  });

  describe('UTF-8 framing, large payloads, binary helpers, timers, and console', () => {
    it('handles multi-byte UTF-8 and emoji across code, globals, and results', async () => {
      const sandbox = new Sandbox();
      try {
        const payload = '🚀 日本語 Ελληνικά العربية 𝕳𝖊𝖑𝖑𝖔';
        const { value, error } = await sandbox.execute({
          code: `
            const suffix = ' — ✨';
            setResult({ value: input + suffix });
          `,
          globals: { input: payload },
          timeout: 3000,
        });

        assert.equal(error, undefined);
        assert.equal(value, `${payload} — ✨`);
      } finally {
        await sandbox.shutdown();
      }
    });

    it('handles large inbound globals and large outbound results', async () => {
      const sandbox = new Sandbox();
      try {
        const largeText = 'a'.repeat(512 * 1024);
        const { value, error } = await sandbox.execute({
          code: 'setResult({ value: largeText.length + ":" + largeText.slice(0, 5) });',
          globals: { largeText },
          timeout: 5000,
        });

        assert.equal(error, undefined);
        assert.equal(value, `${512 * 1024}:aaaaa`);
      } finally {
        await sandbox.shutdown();
      }
    });

    it('round-trips bufferToBase64 / base64ToBuffer across all padding lengths (0..6 bytes)', async () => {
      const sandbox = new Sandbox();
      try {
        const inputs = [
          Buffer.alloc(0),
          Buffer.from([0xff]),
          Buffer.from([0x00, 0x7f]),
          Buffer.from([1, 2, 3]),
          Buffer.from([10, 20, 30, 40]),
          Buffer.from([0xde, 0xad, 0xbe, 0xef, 0x01]),
          Buffer.from([0, 1, 2, 253, 254, 255]),
        ].map((b) => b.toString('base64'));

        const { value, error } = await sandbox.execute({
          code: `
            setResult({
              value: inputs.map((b64) => bufferToBase64(base64ToBuffer(b64))),
            });
          `,
          globals: { inputs },
          timeout: 3000,
        });

        assert.equal(error, undefined);
        assert.deepEqual(value, inputs);
      } finally {
        await sandbox.shutdown();
      }
    });

    it('handles falsy setResult values (0, false, empty string, null, empty array/object)', async () => {
      const sandbox = new Sandbox();
      try {
        for (const expected of [0, false, '', null, [], {}]) {
          const { value, error } = await sandbox.execute({
            code: `setResult({ value: ${JSON.stringify(expected)} });`,
            timeout: 3000,
          });
          assert.equal(error, undefined);
          assert.deepEqual(value, expected);
        }
      } finally {
        await sandbox.shutdown();
      }
    });

    it('formats console.log and console.error output with types and timestamps', async () => {
      const sandbox = new Sandbox();
      try {
        const { output, error } = await sandbox.execute({
          code: `
            console.log('count=%d name=%s', 3, 'test');
            console.error('oops', { ok: false });
            setResult({ value: true });
          `,
          timeout: 3000,
        });

        assert.equal(error, undefined);
        assert.equal(output?.length, 2);
        assert.equal(output?.[0].type, 'log');
        assert.equal(output?.[0].message, 'count=3 name=test');
        assert.ok(output?.[0].time instanceof Date);
        assert.equal(output?.[1].type, 'error');
        assert.match(output?.[1].message || '', /oops/);
      } finally {
        await sandbox.shutdown();
      }
    });

    it('handles clearTimeout edge cases (invalid ID, 0ms delay, disabled timers)', async () => {
      const sandbox = new Sandbox();
      try {
        const { value, error } = await sandbox.execute({
          code: `
            clearTimeout(999999);
            clearTimeout(null);
            setTimeout(() => setResult({ value: 'ok' }), 0);
          `,
          timeout: 3000,
        });
        assert.equal(error, undefined);
        assert.equal(value, 'ok');
      } finally {
        await sandbox.shutdown();
      }

      const disabled = new Sandbox({ timersEnabled: false });
      try {
        const { error } = await disabled.execute({
          code: 'clearTimeout(1);',
          timeout: 3000,
        });
        assert.equal(error?.message, 'Uncaught Error: clearTimeout is disabled');
      } finally {
        await disabled.shutdown();
      }
    });

    it('cleans up custom socketPath file on shutdown', async () => {
      const customDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v8-sandbox-sock-'));
      const sandbox = new Sandbox({ socketPath: customDir });
      try {
        const { value, error } = await sandbox.execute({
          code: 'setResult({ value: 123 });',
          timeout: 3000,
        });
        assert.equal(error, undefined);
        assert.equal(value, 123);

        const socketFile = sandbox.socketName;
        assert.equal(path.dirname(socketFile), customDir);
        assert.equal(fs.existsSync(socketFile), true);

        await sandbox.shutdown();
        assert.equal(fs.existsSync(socketFile), false);
      } finally {
        fs.rmSync(customDir, { recursive: true, force: true });
      }
    });
  });

  describe('modern V8 language features', () => {
    it('supports modern ES/V8 built-ins (Object.groupBy, Promise.withResolvers, Set methods, BigInt, Array.at)', async () => {
      const sandbox = new Sandbox();
      try {
        const { value, error } = await sandbox.execute({
          code: `
            (async () => {
              const grouped = Object.groupBy(
                [{ k: 'a', v: 1 }, { k: 'b', v: 2 }, { k: 'a', v: 3 }],
                (x) => x.k,
              );
              const { promise, resolve } = Promise.withResolvers();
              setTimeout(() => resolve('resolved'), 5);
              const waited = await promise;
              const union = [...new Set([1, 2]).union(new Set([2, 3]))];
              const last = [10, 20, 30].at(-1);
              const big = (9007199254740993n + 1n).toString();
              const hasOwn = Object.hasOwn({ a: 1 }, 'a');
              setResult({
                value: {
                  groupedA: grouped.a.map((x) => x.v),
                  waited,
                  union,
                  last,
                  big,
                  hasOwn,
                },
              });
            })();
          `,
          timeout: 3000,
        });

        assert.equal(error, undefined);
        assert.deepEqual(value, {
          groupedA: [1, 3],
          waited: 'resolved',
          union: [1, 2, 3],
          last: 30,
          big: '9007199254740994',
          hasOwn: true,
        });
      } finally {
        await sandbox.shutdown();
      }
    });
  });
});
