"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _child_process = require("child_process");

var _path = _interopRequireDefault(require("path"));

var _async = _interopRequireDefault(require("async"));

var _os = _interopRequireDefault(require("os"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

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

class Cluster {
  constructor({
    workers,
    require,
    template
  } = {}) {
    _defineProperty(this, "worker", (task, callback) => {
      this._execute(task, callback);
    });

    this._workerCount = workers || Math.max(_os.default.cpus().length, 4);
    this._require = require;
    this._template = template;
    this._workers = {};
    this.start();
  }

  start() {
    this._inactiveWorkers = [];
    this._activeWorkers = [];
    this._queue = _async.default.queue(this.worker, this._workerCount);
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

    this._queue = _async.default.queue(this.worker, this._workerCount);
  }

  ensureWorkers() {
    for (let number = 0; number < this._workerCount; ++number) {
      const worker = this._workers[number];

      if (!worker) {
        const newWorker = this.forkWorker(number); // console.log('forking', number, newWorker.pid);

        newWorker.send({
          initialize: true,
          require: this._require,
          template: this._template
        });
        this._workers[number] = newWorker;

        this._inactiveWorkers.push(newWorker);
      }
    }
  }

  forkWorker(number) {
    const worker = (0, _child_process.fork)(_path.default.join(__dirname, 'worker'), [number]);
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
      throw new Error('invalid worker count', 'active:', this._activeWorkers.length, 'inactive:', this._inactiveWorkers.length);
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

  execute({
    code,
    context,
    timeout
  }) {
    const item = {
      code,
      timeout,
      context
    };
    return new Promise((resolve, reject) => {
      this._queue.push(item, resolve);
    });
  }

  _execute({
    code,
    context,
    timeout
  }, callback) {
    this.popWorker(worker => {
      worker.removeAllListeners();
      worker.on('message', message => {
        this.finishWorker(worker);
        callback(message);
      });
      worker.on('error', message => {
        this.removeWorker(worker);
        callback({
          error: new Error('worker error')
        });
      });
      worker.on('disconnect', () => {
        this.removeWorker(worker);
        callback({
          error: new Error('worker disconnected')
        });
      });
      worker.on('exit', message => {
        this.removeWorker(worker);
      });

      if (timeout > 0) {
        worker.executionTimeout = setTimeout(() => {
          // worker.kill();
          this.removeWorker(worker);
          callback({
            error: new TimeoutError('timeout')
          });
        }, timeout);
      }

      worker.send({
        code,
        context: JSON.stringify(context || {})
      });
    });
  }

}

exports.default = Cluster;
//# sourceMappingURL=cluster.js.map