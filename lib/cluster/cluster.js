import { fork } from 'child_process';
import path from 'path';
import async from 'async';
import os from 'os';

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

export default class Cluster {
  constructor({ workers, require, template } = {}) {
    this._workerCount = workers || Math.max(os.cpus().length, 4);
    this._require = require;
    this._template = template;
    this._workers = {};
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
      this.clearWorkerTimeout(worker);
      worker.removeAllListeners();
      worker.kill();
    }

    for (const worker of this._activeWorkers) {
      this.clearWorkerTimeout(worker);
      worker.removeAllListeners();
      worker.kill();
    }

    this._inactiveWorkers = [];
    this._activeWorkers = [];
    this._workers = {};

    if (this._queue) {
      this._queue.kill();
    }

    this._queue = async.queue(this.worker, this._workerCount);
  }

  worker = (task, callback) => {
    this._execute(task, callback);
  }

  ensureWorkers() {
    for (let number = 0; number < this._workerCount; ++number) {
      const worker = this._workers[number];

      if (!worker) {
        const newWorker = this.forkWorker(number);

        // console.log('forking', number, newWorker.pid);

        newWorker.send({ initialize: true,
                         require: this._require,
                         template: this._template });
  
        this._workers[number] = newWorker;

        this._inactiveWorkers.push(newWorker);
      }
    }
  }

  forkWorker(number) {
    const worker = fork(path.join(__dirname, 'worker'), [ number ]);

    worker.number = number;

    return worker;
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
    // console.log('removing worker', worker.number, worker.pid);
    this.clearWorkerTimeout(worker);
    worker.kill();
    worker.removeAllListeners();
    remove(this._activeWorkers, worker);
    remove(this._inactiveWorkers, worker);

    delete this._workers[worker.number];

    this.ensureWorkers();
  }

  execute({ code, context, timeout }) {
    const item = {
      code, timeout, context
    };

    return new Promise((resolve, reject) => {
      this._queue.push(item, resolve);
    });
  }

  _execute({ code, context, timeout }, callback) {
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
          // worker.kill();
          this.removeWorker(worker);
          callback({error: new TimeoutError('timeout')});
        }, timeout);
      }

      worker.send({ code, context: JSON.stringify(context || {}) });
    });
  }
}