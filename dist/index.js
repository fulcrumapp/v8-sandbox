'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _child_process = require('child_process');

var _path = require('path');

var _path2 = _interopRequireDefault(_path);

var _async = require('async');

var _async2 = _interopRequireDefault(_async);

var _os = require('os');

var _os2 = _interopRequireDefault(_os);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

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

class Sandbox {
  constructor() {
    let options = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};

    this.worker = (task, callback) => {
      this._execute(task, callback);
    };

    this._workerCount = options.workers || Math.max(_os2.default.cpus().length, 4);
    this._require = options.require;
    this.start();
  }

  start() {
    this._inactiveWorkers = [];
    this._activeWorkers = [];
    this._queue = _async2.default.queue(this.worker, this._workerCount);
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

    this._queue = _async2.default.queue(this.worker, this._workerCount);
  }

  ensureWorkers() {
    const total = this._inactiveWorkers.length + this._activeWorkers.length;

    for (let i = 0; i < this._workerCount - total; ++i) {
      const worker = this.forkWorker();

      if (this._require) {
        worker.send({ require: this._require });
      }

      this._inactiveWorkers.push(worker);
    }
  }

  forkWorker() {
    return (0, _child_process.fork)(_path2.default.join(__dirname, 'worker'));
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
      throw new Error('invalid worker count', 'active:', this._activeWorkers.length, 'inactive:', this._inactiveWorkers.length);
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
    worker.removeAllListeners();
    remove(this._activeWorkers, worker);
    remove(this._inactiveWorkers, worker);
    this.ensureWorkers();
  }

  execute(_ref, callback) {
    let code = _ref.code,
        context = _ref.context,
        timeout = _ref.timeout;

    const item = {
      code: code, timeout: timeout, context: context
    };

    let promise = null;

    if (callback == null) {
      let itemResolve = null;
      let itemReject = null;

      promise = new Promise((resolve, reject) => {
        itemResolve = resolve;
        itemReject = reject;
      });

      callback = (err, value) => {
        if (err) {
          return itemReject(err);
        }

        return itemResolve(value);
      };
    }

    this._queue.push(item, callback);

    return promise;
  }

  _execute(_ref2, callback) {
    let code = _ref2.code,
        context = _ref2.context,
        timeout = _ref2.timeout;

    this.popWorker(worker => {
      worker.removeAllListeners();

      worker.on('message', message => {
        this.finishWorker(worker);
        callback(message.err, message.value);
      });

      worker.on('error', message => {
        this.removeWorker(worker);
      });

      worker.on('disconnect', () => {
        this.removeWorker(worker);
      });

      worker.on('exit', message => {
        this.removeWorker(worker);
      });

      if (timeout > 0) {
        worker.executionTimeout = setTimeout(() => {
          this.removeWorker(worker);
          worker.kill();
          callback(new TimeoutError('timeout'));
        }, timeout);
      }

      worker.send({ code: code, context: JSON.stringify(context || {}) });
    });
  }
}
exports.default = Sandbox;
//# sourceMappingURL=index.js.map