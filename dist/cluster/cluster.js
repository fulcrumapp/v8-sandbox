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
  } = {
    workers: null,
    require: null,
    template: null
  }) {
    _defineProperty(this, "_workerCount", void 0);

    _defineProperty(this, "_require", void 0);

    _defineProperty(this, "_template", void 0);

    _defineProperty(this, "_inactiveWorkers", void 0);

    _defineProperty(this, "_activeWorkers", void 0);

    _defineProperty(this, "_queue", void 0);

    _defineProperty(this, "worker", (task, callback) => {
      this._execute(task, callback);
    });

    this._workerCount = workers || Math.max(_os.default.cpus().length, 4);
    this._require = require;
    this._template = template;
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

    if (this._queue) {
      this._queue.kill();
    }

    this._queue = _async.default.queue(this.worker, this._workerCount);
  }

  ensureWorkers() {
    const total = this._inactiveWorkers.length + this._activeWorkers.length;

    for (let i = 0; i < this._workerCount - total; ++i) {
      const worker = this.forkWorker();
      worker.send({
        initialize: true,
        require: this._require,
        template: this._template
      });

      this._inactiveWorkers.push(worker);
    }
  }

  forkWorker() {
    return (0, _child_process.fork)(_path.default.join(__dirname, 'worker'));
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
    remove(this._activeWorkers, worker);

    this._inactiveWorkers.push(worker);
  }

  removeWorker(worker) {
    this.clearWorkerTimeout(worker);
    worker.kill();
    worker.removeAllListeners();
    remove(this._activeWorkers, worker);
    remove(this._inactiveWorkers, worker);
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