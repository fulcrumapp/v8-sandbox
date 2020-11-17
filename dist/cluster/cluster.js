"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _child_process = require("child_process");

var _path = _interopRequireDefault(require("path"));

var _async = _interopRequireDefault(require("async"));

var _os = _interopRequireDefault(require("os"));

var _signalExit = _interopRequireDefault(require("signal-exit"));

var _lodash = require("lodash");

var _sandbox = require("../server/sandbox");

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

function remove(array, object) {
  const index = array.indexOf(object);

  if (index > -1) {
    array.splice(index, 1);
  }
}

class Cluster {
  constructor({
    workers,
    ...options
  } = {}) {
    _defineProperty(this, "workerCount", void 0);

    _defineProperty(this, "inactiveWorkers", void 0);

    _defineProperty(this, "activeWorkers", void 0);

    _defineProperty(this, "queue", void 0);

    _defineProperty(this, "sandboxOptions", void 0);

    _defineProperty(this, "worker", (task, callback) => {
      this._execute(task, callback);
    });

    this.workerCount = workers || Math.max(_os.default.cpus().length, 4);
    this.sandboxOptions = options;
    this.start();
  }

  start() {
    this.inactiveWorkers = [];
    this.activeWorkers = [];
    this.queue = _async.default.queue(this.worker, this.workerCount);
    this.ensureWorkers();
    (0, _signalExit.default)((code, signal) => {
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

    this.queue = _async.default.queue(this.worker, this.workerCount);
  }

  ensureWorkers() {
    const total = this.inactiveWorkers.length + this.activeWorkers.length;

    for (let i = 0; i < this.workerCount - total; ++i) {
      const worker = this.forkWorker();
      worker.send({
        initialize: true,
        ...this.sandboxOptions
      });
      this.inactiveWorkers.push(worker);
    }
  }

  forkWorker() {
    return (0, _child_process.fork)(_path.default.join(__dirname, 'worker'), [], {
      gid: this.sandboxOptions.gid,
      uid: this.sandboxOptions.uid
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
    code,
    timeout,
    globals,
    context
  }) {
    return new Promise((resolve, reject) => {
      const item = {
        code,
        timeout,
        globals: globals || {},
        context: context || {}
      };
      this.queue.push(item, resolve);
    });
  }

  _execute({
    code,
    timeout,
    globals,
    context
  }, callback) {
    callback = (0, _lodash.once)(callback);
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
          this.removeWorker(worker);
          callback({
            error: new _sandbox.TimeoutError(timeout)
          });
        }, timeout);
      }

      worker.send({
        code,
        globals: JSON.stringify(globals),
        context: JSON.stringify(context)
      });
    });
  }

}

exports.default = Cluster;
//# sourceMappingURL=cluster.js.map