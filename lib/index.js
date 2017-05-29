import {fork} from 'child_process';
import path from 'path';

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

export default class Sandbox {
  constructor(options = {}) {
    this._workerCount = options.workers || 4;
    this.start();
  }

  start() {
    this._inactiveWorkers = [];
    this._activeWorkers = [];
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
  }

  ensureWorkers() {
    const total = this._inactiveWorkers.length + this._activeWorkers;

    for (let i = 0; i < this._workerCount - total; ++i) {
      this._inactiveWorkers.push(this.forkWorker());
    }
  }

  forkWorker() {
    return fork(path.join(__dirname, 'worker'));
  }

  popWorker(callback) {
    this.ensureWorkers();

    if (this._inactiveWorkers.length === 0) {
      setTimeout(() => {
        this.popWorker(callback);
      }, 1);

      return;
    }

    const worker = this._inactiveWorkers.shift();
    this._activeWorkers.push(worker);

    if (this._activeWorkers.length + this._inactiveWorkers.length !== this._workerCount) {
      throw new Error('invalid worker count');
    }

    callback(worker);
  }

  finishWorker(worker) {
    clearTimeout(worker.executionTimeout);
    worker.executionTimeout = null;
    remove(this._activeWorkers, worker);
    this._inactiveWorkers.push(worker);
  }

  removeWorker(worker) {
    clearTimeout(worker.executionTimeout);
    worker.executionTimeout = null;
    remove(this._activeWorkers, worker);
    remove(this._inactiveWorkers, worker);
    this.ensureWorkers();
  }

  execute(code, timeout, callback) {
    if (callback == null) {
      return new Promise((resolve, reject) => {
        this._execute(code, timeout, (err, value) => {
          if (err) {
            return reject(err);
          }

          return resolve(value);
        });
      });
    }

    return this._execute(code, timeout, callback);
  }

  _execute(code, timeout, callback) {
    this.popWorker((worker) => {
      worker.removeAllListeners();

      worker.on('message', (message) => {
        this.finishWorker(worker);
        callback(message.err, message.value);
      });

      worker.on('error', (message) => {
        this.removeWorker(worker);
      });

      worker.on('disconnect', () => {
        this.removeWorker(worker);
      });

      worker.on('exit', (message) => {
        this.removeWorker(worker);
      });

      if (timeout > 0) {
        worker.executionTimeout = setTimeout(() => {
          this.removeWorker(worker);
          worker.kill();
          callback(new TimeoutError('timeout'));
        }, timeout);
      }

      worker.send({code});
    });
  }
}
