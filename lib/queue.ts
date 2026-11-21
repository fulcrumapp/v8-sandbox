import once from './once';

type QueueWorker<T> =
  | ((task: T) => Promise<void>)
  | ((task: T, callback: (...args: any[]) => void) => void);

interface QueueEntry<T> {
  task: T;
  callback?: (...args: any[]) => void;
}

export default class Queue<T> {
  private worker: QueueWorker<T>;

  private concurrency: number;

  private active: number = 0;

  private pending: QueueEntry<T>[] = [];

  private killed: boolean = false;

  constructor(worker: QueueWorker<T>, concurrency: number = 1) {
    this.worker = worker;
    this.concurrency = concurrency;
  }

  push(task: T, callback?: (...args: any[]) => void) {
    if (this.killed) {
      return;
    }

    this.pending.push({ task, callback });
    this.drain();
  }

  kill() {
    this.killed = true;
    this.pending = [];
  }

  private drain() {
    while (!this.killed && this.active < this.concurrency && this.pending.length > 0) {
      const entry = this.pending.shift();

      if (!entry) {
        return;
      }

      this.active += 1;

      const finish = once((...args: any[]) => {
        this.active -= 1;

        if (!this.killed && entry.callback) {
          entry.callback(...args);
        }

        this.drain();
      });

      if (this.worker.length >= 2) {
        (this.worker as (task: T, callback: (...args: any[]) => void) => void)(entry.task, finish);
      } else {
        Promise.resolve((this.worker as (task: T) => Promise<void>)(entry.task))
          .then(() => finish(), (err) => finish(err));
      }
    }
  }
}
