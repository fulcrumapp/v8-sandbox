"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = exports.TimeoutError = void 0;

var _path = _interopRequireDefault(require("path"));

var _net = _interopRequireDefault(require("net"));

var _fs = _interopRequireDefault(require("fs"));

var _child_process = require("child_process");

var _async = _interopRequireDefault(require("async"));

var _lodash = require("lodash");

var _signalExit = _interopRequireDefault(require("signal-exit"));

var _timer = _interopRequireDefault(require("./timer"));

var _socket = _interopRequireDefault(require("./socket"));

var _functions = _interopRequireDefault(require("./functions"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

class TimeoutError extends Error {
  get isTimeout() {
    return true;
  }

}

exports.TimeoutError = TimeoutError;
let nextID = 0;

class Sandbox {
  constructor({
    require,
    template,
    httpEnabled,
    timersEnabled,
    memory,
    argv
  } = {}) {
    _defineProperty(this, "id", void 0);

    _defineProperty(this, "template", void 0);

    _defineProperty(this, "initializeTimeout", void 0);

    _defineProperty(this, "argv", void 0);

    _defineProperty(this, "executeTimeout", void 0);

    _defineProperty(this, "server", void 0);

    _defineProperty(this, "worker", void 0);

    _defineProperty(this, "initialized", void 0);

    _defineProperty(this, "socket", void 0);

    _defineProperty(this, "queue", void 0);

    _defineProperty(this, "message", void 0);

    _defineProperty(this, "functions", void 0);

    _defineProperty(this, "running", void 0);

    _defineProperty(this, "memory", void 0);

    _defineProperty(this, "handleTimeout", () => {
      this.fork();
      this.finish({
        error: new TimeoutError(`timeout: ${this.message.timeout}ms`)
      });
    });

    _defineProperty(this, "processMessage", async message => {
      this.message = message;
      return new Promise(resolve => {
        const {
          callback
        } = this.message;
        this.message.callback = (0, _lodash.once)(result => {
          callback(result);
          resolve();
        });

        switch (message.type) {
          case 'initialize':
            return this.onInitialize(message);

          case 'execute':
            return this.onExecute(message);

          default:
            this.finish({
              error: new Error('invalid message')
            });
        }
      });
    });

    _defineProperty(this, "handleConnection", socket => {
      this.socket = new _socket.default(socket, this);
    });

    _defineProperty(this, "handleError", error => {
      console.error('server error', error);
    });

    this.id = `v8-sandbox-${process.pid}-${++nextID}`;
    this.initializeTimeout = new _timer.default();
    this.executeTimeout = new _timer.default();
    this.memory = memory;
    this.argv = argv !== null && argv !== void 0 ? argv : [];
    this.template = template || '';
    this.functions = new _functions.default(this, {
      require,
      httpEnabled,
      timersEnabled
    });
    this.start();
    (0, _signalExit.default)((code, signal) => {
      this.shutdown(null);
    });
  }

  initialize({
    timeout
  } = {
    timeout: null
  }) {
    return new Promise(resolve => {
      this.queue.push({
        type: 'initialize',
        template: [this.functions.defines().join('\n'), this.template].join('\n'),
        timeout,
        output: [],
        callback: result => {
          this.initialized = true;
          resolve(result);
        }
      });
    });
  }

  async execute({
    code,
    context,
    timeout
  }) {
    this.start();
    const result = await this.initialize({
      timeout
    });

    if (result.error) {
      return result;
    }

    return new Promise(resolve => {
      this.queue.push({
        type: 'execute',
        code,
        timeout,
        context: context || {},
        output: [],
        callback: result => {
          this.initialized = false;
          resolve(result);
        }
      });
    });
  }

  get socketName() {
    return process.platform === 'win32' ? _path.default.join('\\\\?\\pipe', process.cwd(), this.id) : `/tmp/${this.id}`;
  }

  dispatch(invocation, {
    fail,
    respond,
    callback
  }) {
    this.functions.dispatch(invocation, {
      message: this.message,
      fail,
      respond,
      callback
    });
  }

  fork() {
    this.kill();
    const execArgv = [...this.argv];

    if (this.memory) {
      execArgv.push(`--max-old-space-size=${this.memory}`);
    }

    const workerPath = _path.default.join(__dirname, '..', 'client', 'worker');

    this.worker = (0, _child_process.fork)(workerPath, [this.socketName], {
      execArgv
    });
    this.worker.on('error', error => {
      this.fork();
      this.finish({
        error
      });
    });
    this.worker.on('exit', () => {
      if (this.running) {
        this.fork();
      }

      this.finish({
        error: new Error('worker exited')
      });
    });
  }

  kill() {
    this.initializeTimeout.clear();
    this.executeTimeout.clear();

    if (this.worker) {
      this.worker.removeAllListeners();

      if (this.worker.connected) {
        this.worker.send({
          type: 'exit'
        });
      }

      this.worker.kill();
      this.worker = null;
      this.initialized = false;
    }
  }

  cleanupSocket() {
    try {
      _fs.default.unlinkSync(this.socketName);
    } catch (ex) {// silent
    }
  }

  start() {
    this.running = true;

    if (this.server) {
      return;
    }

    this.shutdown(null);
    this.server = _net.default.createServer();
    this.server.on('connection', this.handleConnection);
    this.server.on('error', this.handleError);
    this.cleanupSocket();
    this.server.listen(this.socketName);
    this.queue = _async.default.queue(this.processMessage, 1);
    this.fork();
  }

  shutdown(callback) {
    this.running = false;
    this.functions.clearTimers();
    this.kill();

    if (this.socket) {
      this.socket.shutdown();
      this.socket = null;
    }

    if (this.server) {
      this.server.close(() => {
        if (callback) {
          callback();
        }
      });
      this.cleanupSocket();
      this.server = null;
    }
  }

  callback(id, args) {
    this.worker.send({
      type: 'callback',
      id,
      args
    });
  }

  onInitialize({
    template,
    timeout
  }) {
    if (this.initialized) {
      return this.finish({});
    }

    this.initializeTimeout.start(timeout, this.handleTimeout);
    this.worker.send({
      type: 'initialize',
      template
    });
  }

  onExecute({
    code,
    context,
    timeout
  }) {
    this.executeTimeout.start(timeout, this.handleTimeout);
    global.context = context;
    this.worker.send({
      type: 'execute',
      code,
      context: JSON.stringify(context)
    });
  }

  finish(result) {
    this.functions.clearTimers();

    if (this.message) {
      this.message.callback({ ...result,
        output: this.message.output
      });
    }
  }

}

exports.default = Sandbox;
//# sourceMappingURL=sandbox.js.map