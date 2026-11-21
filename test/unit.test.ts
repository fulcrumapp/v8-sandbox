import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'vitest';
import once from '../lib/once';
import Queue from '../lib/queue';
import SandboxCluster from '../lib/cluster/cluster';
import Timer from '../lib/host/timer';
import Socket from '../lib/host/socket';

describe('once', () => {
  it('invokes the wrapped function only once and caches the result', () => {
    let calls = 0;
    const fn = once((a: number, b: number) => {
      calls += 1;
      return a + b;
    });

    assert.equal(fn(2, 3), 5);
    assert.equal(fn(10, 20), 5);
    assert.equal(calls, 1);
  });

  it('caches falsy return values without re-invoking', () => {
    for (const expected of [0, false, '', null, undefined]) {
      let calls = 0;
      const fn = once(() => {
        calls += 1;
        return expected;
      });

      assert.equal(fn(), expected);
      assert.equal(fn(), expected);
      assert.equal(calls, 1);
    }
  });

  it('preserves `this` binding on the first call', () => {
    const obj = {
      value: 42,
      get: once(function getValue(this: { value: number }) {
        return this.value;
      }),
    };

    assert.equal(obj.get(), 42);
    obj.value = 99;
    assert.equal(obj.get(), 42);
  });
});

describe('Queue', () => {
  it('enforces concurrency=1 and FIFO ordering for async workers', async () => {
    const order: number[] = [];
    let inFlight = 0;
    let maxInFlight = 0;

    const queue = new Queue<number>(async (item) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, item === 1 ? 25 : 5));
      order.push(item);
      inFlight -= 1;
    }, 1);

    await Promise.all([1, 2, 3, 4].map((n) => new Promise<void>((resolve) => {
      queue.push(n, () => resolve());
    })));

    assert.equal(maxInFlight, 1);
    assert.deepEqual(order, [1, 2, 3, 4]);
  });

  it('runs up to concurrency=N tasks in parallel for callback workers', async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    const queue = new Queue<number>((item, done) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      setTimeout(() => {
        inFlight -= 1;
        done(item * 10);
      }, 20);
    }, 3);

    const results = await Promise.all([1, 2, 3, 4, 5, 6].map((n) => new Promise<number>((resolve) => {
      queue.push(n, resolve);
    })));

    assert.equal(maxInFlight, 3);
    assert.deepEqual(results, [10, 20, 30, 40, 50, 60]);
  });

  it('ignores duplicate done() calls without corrupting active concurrency', async () => {
    let completed = 0;
    const queue = new Queue<number>((item, done) => {
      setTimeout(() => {
        done(item);
        done(item + 100);
      }, 5);
    }, 1);

    const results = await Promise.all([1, 2, 3].map((n) => new Promise<number>((resolve) => {
      queue.push(n, (res) => {
        completed += 1;
        resolve(res);
      });
    })));

    assert.equal(completed, 3);
    assert.deepEqual(results, [1, 2, 3]);
  });

  it('kill() drops pending tasks and suppresses callbacks for in-flight tasks', async () => {
    const started: number[] = [];
    const callbacks: number[] = [];

    const queue = new Queue<number>((item, done) => {
      started.push(item);
      setTimeout(() => done(item), 30);
    }, 1);

    queue.push(1, (v) => callbacks.push(v));
    queue.push(2, (v) => callbacks.push(v));
    queue.push(3, (v) => callbacks.push(v));

    queue.kill();
    queue.push(4, (v) => callbacks.push(v));

    await new Promise((resolve) => setTimeout(resolve, 60));

    assert.deepEqual(started, [1]);
    assert.deepEqual(callbacks, []);
  });

  it('rejects invalid concurrency values immediately', () => {
    for (const invalid of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
      assert.throws(() => new Queue(async () => {}, invalid), RangeError);
    }

    assert.throws(() => new SandboxCluster({ workers: 0 }), RangeError);
  });

  it('drains a large synchronous backlog without overflowing the call stack', async () => {
    const count = 10000;
    let processed = 0;

    const queue = new Queue<number>((item, done) => {
      if (item === 0) {
        setTimeout(() => {
          processed += 1;
          done(item);
        }, 5);
      } else {
        processed += 1;
        done(item);
      }
    }, 1);

    const lastCompleted = new Promise<number>((resolve) => {
      for (let i = 0; i < count; i += 1) {
        queue.push(i, i === count - 1 ? resolve : undefined);
      }
    });

    const lastValue = await lastCompleted;
    assert.equal(lastValue, count - 1);
    assert.equal(processed, count);
  });
});

describe('Timer', () => {
  it('fires callback and clears running state', async () => {
    const timer = new Timer();
    assert.equal(timer.isRunning(), false);

    await new Promise<void>((resolve) => {
      timer.start(10, () => {
        assert.equal(timer.isRunning(), false);
        resolve();
      });
      assert.equal(timer.isRunning(), true);
    });
  });

  it('invokes cancel callback when cleared before firing', async () => {
    const timer = new Timer();
    let fired = false;
    let cancelled = false;

    timer.start(50, () => {
      fired = true;
    }, () => {
      cancelled = true;
    });

    timer.clear();
    assert.equal(timer.isRunning(), false);
    assert.equal(cancelled, true);

    await new Promise((resolve) => setTimeout(resolve, 70));
    assert.equal(fired, false);
  });
});

describe('Socket IPC framing', () => {
  function makeMockSocket() {
    const emitter = new EventEmitter() as any;
    emitter.written = [] as Buffer[];
    emitter.destroyed = false;
    emitter.write = (buf: Buffer) => {
      emitter.written.push(buf);
      return true;
    };
    emitter.end = () => {};
    emitter.unref = () => {};
    emitter.resume = () => {};
    emitter.destroy = () => {
      emitter.destroyed = true;
    };
    return emitter;
  }

  function encodeFrame(messageId: number, callbackId: number, payload: string): Buffer {
    const body = Buffer.from(payload, 'utf8');
    const buf = Buffer.alloc(12 + body.length);
    buf.writeInt32BE(messageId, 0);
    buf.writeInt32BE(callbackId, 4);
    buf.writeInt32BE(body.length, 8);
    body.copy(buf, 12);
    return buf;
  }

  it('handles split headers (1 byte + 11 bytes + body) without throwing', () => {
    const rawSocket = makeMockSocket();
    const dispatched: any[] = [];
    const fakeSandbox: any = {
      worker: {},
      debug: false,
      dispatch(messageId: number, invocation: any, { respond }: any) {
        dispatched.push({ messageId, invocation });
        respond('ok');
      },
    };

    const sock = new Socket(rawSocket, fakeSandbox);
    const frame = encodeFrame(7, 0, JSON.stringify({ name: 'ping', args: [1] }));

    assert.doesNotThrow(() => {
      rawSocket.emit('data', frame.subarray(0, 1));
      rawSocket.emit('data', frame.subarray(1, 12));
      rawSocket.emit('data', frame.subarray(12));
    });

    assert.equal(dispatched.length, 1);
    assert.deepEqual(dispatched[0], { messageId: 7, invocation: { name: 'ping', args: [1] } });
    sock.shutdown();
  });

  it('handles two coalesced frames in a single data chunk', () => {
    const rawSocket = makeMockSocket();
    const dispatched: any[] = [];
    const fakeSandbox: any = {
      worker: {},
      debug: false,
      dispatch(messageId: number, invocation: any, { respond }: any) {
        dispatched.push({ messageId, invocation });
        respond('ok');
      },
    };

    const sock = new Socket(rawSocket, fakeSandbox);
    const combined = Buffer.concat([
      encodeFrame(1, 0, JSON.stringify({ name: 'a', args: [] })),
      encodeFrame(2, 0, JSON.stringify({ name: 'b', args: [] })),
    ]);

    assert.doesNotThrow(() => {
      rawSocket.emit('data', combined);
    });

    assert.equal(dispatched.length, 2);
    assert.equal(dispatched[0].invocation.name, 'a');
    assert.equal(dispatched[1].invocation.name, 'b');
    sock.shutdown();
  });

  it('rejects negative and oversized frame lengths by destroying the socket without throwing', () => {
    for (const badLength of [-1, 0x7fffffff]) {
      const rawSocket = makeMockSocket();
      const fakeSandbox: any = { worker: {}, debug: false, dispatch() {} };
      new Socket(rawSocket, fakeSandbox);

      const badHeader = Buffer.alloc(12);
      badHeader.writeInt32BE(1, 0);
      badHeader.writeInt32BE(0, 4);
      badHeader.writeInt32BE(badLength, 8);

      assert.doesNotThrow(() => {
        rawSocket.emit('data', badHeader);
      });
      assert.equal(rawSocket.destroyed, true);
    }
  });
});
