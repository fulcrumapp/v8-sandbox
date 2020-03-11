import {fork} from 'child_process';
import path from 'path';
import async from 'async';
import os from 'os';
import Sandbox from './sandbox';

class TimeoutError extends Error {
  get isTimeout() {
    return true;
  }
}

function remove(array, object) {
  const index = array.indexOf(object);

  if (index > -1) {
    array.splice(index, 1);
  }
}

export { Sandbox };

export default class SandboxCluster {
  constructor(options = {}) {
    this._workerCount = options.workers || Math.max(os.cpus().length, 1);
    this._require = options.require;
    this._template = options.template;
    this.start();
  }

  start() {
    this._inactiveWorkers = [];
    this._activeWorkers = [];
    this._queue = async.queue(this.worker, this._workerCount);
    this.ensureWorkers();
  }

  shutdown() {
    for (const worker of this._inactiveWorkers) {
      worker.removeAllListeners();
      worker.kill();
    }

    for (const worker of this._activeWorkers) {
      worker.removeAllListeners();
      worker.kill();
    }

    this._inactiveWorkers = [];
    this._activeWorkers = [];

    if (this._queue) {
      this._queue.kill();
    }

    this._queue = async.queue(this.worker, this._workerCount);
  }

  worker = (task, callback) => {
    this._execute(task, callback);
  }

  ensureWorkers() {
    const total = this._inactiveWorkers.length + this._activeWorkers.length;

    for (let i = 0; i < this._workerCount - total; ++i) {
      const worker = this.forkWorker();

      worker.send({initialize: true,
                   require: this._require,
                   template: this._template});

      this._inactiveWorkers.push(worker);
    }
  }

  forkWorker() {
    return fork(path.join(__dirname, 'worker'));
  }

  popWorker(callback) {
    this.ensureWorkers();

    if (this._inactiveWorkers.length === 0) {
      setImmediate(() => {
        this.popWorker(callback);
      });

      return;
    }

    const worker = this._inactiveWorkers.shift();

    this._activeWorkers.push(worker);

    if (this._activeWorkers.length + this._inactiveWorkers.length !== this._workerCount) {
      throw new Error('invalid worker count',
        'active:', this._activeWorkers.length,
        'inactive:', this._inactiveWorkers.length);
    }

    callback(worker);
  }

  clearWorkerTimeout(worker) {
    clearTimeout(worker.executionTimeout);
    worker.executionTimeout = null;
  }

  finishWorker(worker) {
    this.clearWorkerTimeout(worker);
    remove(this._activeWorkers, worker);
    this._inactiveWorkers.push(worker);
  }

  removeWorker(worker) {
    this.clearWorkerTimeout(worker);
    worker.removeAllListeners();
    remove(this._activeWorkers, worker);
    remove(this._inactiveWorkers, worker);
    this.ensureWorkers();
  }

  execute({code, context, timeout}) {
    const item = {
      code, timeout, context
    };

    return new Promise((resolve, reject) => {
      this._queue.push(item, resolve);
    });
  }

  _execute({code, context, timeout}, callback) {
    this.popWorker((worker) => {
      worker.removeAllListeners();

      worker.on('message', (message) => {
        this.finishWorker(worker);

        callback(message);
      });

      worker.on('error', (message) => {
        this.removeWorker(worker);

        callback({error: new Error('worker error')});
      });

      worker.on('disconnect', () => {
        this.removeWorker(worker);

        callback({error: new Error('worker disconnected')});
      });

      worker.on('exit', (message) => {
        this.removeWorker(worker);
      });

      if (timeout > 0) {
        worker.executionTimeout = setTimeout(() => {
          this.removeWorker(worker);
          worker.kill();
          callback({error: new TimeoutError('timeout')});
        }, timeout);
      }

      worker.send({code, context: JSON.stringify(context || {})});
    });
  }
}
