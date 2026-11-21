import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import once from '../lib/once';
import Queue from '../lib/queue';
import Timer from '../lib/host/timer';

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
