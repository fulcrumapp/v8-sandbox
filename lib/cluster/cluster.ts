import { fork, ChildProcess } from 'child_process';
import path from 'path';
import async from 'async';
import os from 'os';
import onExit from 'signal-exit';
import { once } from 'lodash';
import { Options, ExecutionOptions, TimeoutError } from '../host/sandbox';

interface ClusterOptions extends Options {
  workers?: number;
}

function remove(array, object) {
  const index = array.indexOf(object);

  if (index > -1) {
    array.splice(index, 1);
  }
}

export default class Cluster {
  workerCount: number;

  inactiveWorkers: ChildProcess[] = [];

  activeWorkers: ChildProcess[] = [];

  queue?: async.QueueObject<ExecutionOptions>;

  sandboxOptions: Options;

  constructor({ workers, ...options }: ClusterOptions = {}) {
    this.workerCount = workers ?? 1;
    this.sandboxOptions = options;
    this.start();
  }

  start() {
    this.inactiveWorkers = [];
    this.activeWorkers = [];
    this.queue = async.queue(this.worker, this.workerCount);
    this.ensureWorkers();

    onExit((code, signal) => {
      this.shutdown();
    });
  }

  shutdown() {
    for (const worker of this.inactiveWorkers) {
      this.clearWorkerTimeout(worker);
      worker.removeAllListeners();
      worker.kill();
    }

    for (const worker of this.activeWorkers) {
      this.clearWorkerTimeout(worker);
      worker.removeAllListeners();
      worker.kill();
    }

    this.inactiveWorkers = [];
    this.activeWorkers = [];

    if (this.queue) {
      this.queue.kill();
    }

    this.queue = async.queue(this.worker, this.workerCount);
  }

  worker = (task, callback) => {
    this._execute(task, callback);
  };

  ensureWorkers() {
    const total = this.inactiveWorkers.length + this.activeWorkers.length;

    for (let i = 0; i < this.workerCount - total; ++i) {
      const worker = this.forkWorker();

      worker.send({ initialize: true, ...this.sandboxOptions });

      this.inactiveWorkers.push(worker);
    }
  }

  forkWorker() {
    return fork(path.join(__dirname, 'worker'), [], {
      execArgv: [], gid: this.sandboxOptions.gid, uid: this.sandboxOptions.uid,
    });
  }

  popWorker(callback) {
    this.ensureWorkers();

    if (this.inactiveWorkers.length === 0) {
      setImmediate(() => {
        this.popWorker(callback);
      });

      return;
    }

    const worker = this.inactiveWorkers.shift();

    if (worker == null) {
      throw new Error('no inactive worker');
    }

    this.activeWorkers.push(worker);

    if (this.activeWorkers.length + this.inactiveWorkers.length !== this.workerCount) {
      throw new Error('invalid worker count');
    }

    callback(worker);
  }

  clearWorkerTimeout(worker) {
    clearTimeout(worker.executionTimeout);
    worker.executionTimeout = null;
  }

  finishWorker(worker) {
    this.clearWorkerTimeout(worker);
    remove(this.activeWorkers, worker);
    this.inactiveWorkers.push(worker);
  }

  removeWorker(worker) {
    this.clearWorkerTimeout(worker);

    worker.kill();
    worker.removeAllListeners();

    remove(this.activeWorkers, worker);
    remove(this.inactiveWorkers, worker);

    this.ensureWorkers();
  }

  execute({
    code, timeout, globals, context,
  }: ExecutionOptions) {
    return new Promise((resolve, reject) => {
      const item = {
        code,
        timeout,
        globals: globals || {},
        context: context || {},
      };

      if (!this.queue) {
        throw new Error('invalid queue');
      }

      this.queue.push(item, resolve);
    });
  }

  _execute({
    code, timeout, globals, context,
  }, callback) {
    callback = once(callback);

    this.popWorker((worker) => {
      worker.removeAllListeners();

      worker.on('message', (message) => {
        this.finishWorker(worker);

        callback(message);
      });

      worker.on('error', (message) => {
        this.removeWorker(worker);

        callback({ error: new Error('worker error') });
      });

      worker.on('disconnect', () => {
        this.removeWorker(worker);

        callback({ error: new Error('worker disconnected') });
      });

      worker.on('exit', (message) => {
        this.removeWorker(worker);
      });

      if (timeout > 0) {
        worker.executionTimeout = setTimeout(() => {
          this.removeWorker(worker);
          callback({ error: new TimeoutError(timeout) });
        }, timeout);
      }

      worker.send({
        code,
        globals: JSON.stringify(globals),
        context: JSON.stringify(context),
      });
    });
  }
}
