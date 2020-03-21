"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _fs = _interopRequireDefault(require("fs"));

var _path = _interopRequireDefault(require("path"));

var _net = _interopRequireDefault(require("net"));

var _util = _interopRequireDefault(require("util"));

var _request = _interopRequireDefault(require("request"));

var _lodash = require("lodash");

var _socket = _interopRequireDefault(require("./socket"));

var _host = _interopRequireDefault(require("./host"));

var _timer = _interopRequireDefault(require("./timer"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

class TimeoutError extends Error {
  get isTimeout() {
    return true;
  }

}

const SYNC_FUNCTIONS = {};
const ASYNC_FUNCTIONS = {};

class Sandbox {
  constructor({
    template,
    require
  } = {
    template: null,
    require: null
  }) {
    _defineProperty(this, "id", void 0);

    _defineProperty(this, "template", void 0);

    _defineProperty(this, "require", void 0);

    _defineProperty(this, "server", void 0);

    _defineProperty(this, "socket", void 0);

    _defineProperty(this, "host", void 0);

    _defineProperty(this, "queue", void 0);

    _defineProperty(this, "timers", void 0);

    _defineProperty(this, "syncFunctions", void 0);

    _defineProperty(this, "asyncFunctions", void 0);

    _defineProperty(this, "item", void 0);

    _defineProperty(this, "handleConnection", socket => {
      this.socket = new _socket.default(socket, this);
    });

    _defineProperty(this, "handleError", error => {
      console.error('server error', error);
    });

    this.id = `v8-sandbox-socket-${process.pid}`;
    this.template = template || '';
    this.require = require;
    this.server = _net.default.createServer();
    this.server.on('connection', this.handleConnection);
    this.server.on('error', this.handleError);
    this.cleanupSocket();
    this.server.listen(this.socketName);
    this.queue = [];
    this.timers = {};
    this.setup();
  }

  setup() {
    if (this.host) {
      this.host.kill();
    }

    this.host = new _host.default(this.socketName);
    global.define = this.define.bind(this);
    global.defineAsync = this.defineAsync.bind(this);
    this.syncFunctions = {};
    this.asyncFunctions = {};

    if (this.require) {
      this.syncFunctions = SYNC_FUNCTIONS[this.require] = SYNC_FUNCTIONS[this.require] || {};
      this.asyncFunctions = ASYNC_FUNCTIONS[this.require] = ASYNC_FUNCTIONS[this.require] || {}; // eslint-disable-next-line global-require

      require(this.require);
    }
  }

  define(name, fn) {
    this.syncFunctions[name] = fn;
  }

  defineAsync(name, fn) {
    this.asyncFunctions[name] = fn;
  }

  defines() {
    return [...Object.entries(this.syncFunctions).map(([name]) => `define('${name}');\n`), ...Object.entries(this.asyncFunctions).map(([name]) => `defineAsync('${name}');\n`)];
  }

  get socketName() {
    return process.platform === 'win32' ? _path.default.join('\\\\?\\pipe', process.cwd(), this.id) : `/tmp/${this.id}`;
  }

  initialize({
    timeout
  } = {
    timeout: null
  }) {
    if (this.host.worker.initialized) {
      return {};
    }

    return new Promise(resolve => {
      this.queue.push({
        type: 'initialize',
        template: [this.defines().join('\n'), this.template].join('\n'),
        output: [],
        timeout,
        callback: (0, _lodash.once)(result => {
          this.host.worker.initialized = true;
          resolve(result);
        })
      });

      if (!this.item) {
        this.next();
      }
    });
  }

  async execute({
    code,
    context,
    timeout
  }) {
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
        context: context || {},
        output: [],
        timeout,
        callback: (0, _lodash.once)(resolve)
      });

      if (!this.item) {
        this.next();
      }
    });
  }

  next() {
    this.item = null;

    if (this.queue.length === 0) {
      return;
    }

    const item = this.item = this.queue.pop();
    this.host.removeAllListeners();
    this.host.on('error', error => {
      console.error('worker error', error);
      this.finish({
        error: new Error('worker error')
      });
      this.next();
    });
    this.host.on('timeout', () => {
      this.finish({
        error: new TimeoutError('timeout')
      });
      this.next();
    });
    this.host.process(item);
  }

  cleanupSocket() {
    try {
      _fs.default.unlinkSync(this.socketName);
    } catch (ex) {// silent
    }
  }

  shutdown(callback) {
    this.clearTimers();
    this.host.kill();

    if (this.socket) {
      this.socket.shutdown();
    }

    this.server.close(() => {
      this.cleanupSocket();

      if (callback) {
        callback();
      }
    });
  }

  finish(result) {
    if (this.item) {
      this.item.callback({ ...result,
        output: this.item.output
      });
      this.item = null;
    }

    this.clearTimers();
  }

  clearTimers() {
    for (const [id, timer] of Object.entries(this.timers)) {
      timer.clear();
      delete this.timers[id];
    }
  }

  dispatch({
    name,
    args
  }, {
    fail,
    respond,
    callback
  }) {
    const params = [args, {
      respond,
      fail,
      callback
    }];

    switch (name) {
      case 'setResult':
        {
          return this.setResult(...params);
        }

      case 'httpRequest':
        {
          return this.httpRequest(...params);
        }

      case 'setTimeout':
        {
          return this.setTimeout(...params);
        }

      case 'clearTimeout':
        {
          return this.clearTimeout(...params);
        }

      case 'log':
        {
          return this.log(...params);
        }

      case 'error':
        {
          return this.error(...params);
        }

      default:
        {
          const fn = this.syncFunctions[name] || this.asyncFunctions[name];

          if (fn) {
            fn(...params);
          } else {
            throw new Error(`${name} is not a valid method`);
          }
        }
    }
  }

  setResult([result], {
    respond
  }) {
    this.finish(result);
    respond();
    this.next();
  }

  setTimeout([timeout], {
    respond,
    callback
  }) {
    const timer = new _timer.default();
    timer.start(timeout || 0, callback);
    const id = timer.id;
    this.timers[id] = timer;
    respond(id);
  }

  clearTimeout([timerID], {
    respond
  }) {
    const timer = this.timers[+timerID];

    if (timer) {
      timer.clear();
      delete this.timers[+timerID];
    }

    respond();
  }

  httpRequest([options], {
    respond,
    callback
  }) {
    const {
      sync
    } = options || {};
    (0, _request.default)(options, (err, response, body) => {
      if (response && Buffer.isBuffer(response.body)) {
        response.body = body = response.body.toString('base64');
      }

      if (sync) {
        respond(err, response, body);
      } else {
        callback(err, response, body);
      }
    });

    if (!sync) {
      respond();
    }
  }

  log([args], {
    respond,
    callback
  }) {
    this.write({
      type: 'log',
      args
    });
    console.log(...args);
    respond();
  }

  error([args], {
    respond,
    callback
  }) {
    this.write({
      type: 'error',
      args
    });
    console.error(...args);
    respond();
  }

  write({
    type,
    args
  }) {
    this.item.output.push({
      type,
      time: new Date(),
      message: _util.default.format(...args)
    });
  }

}

exports.default = Sandbox;
//# sourceMappingURL=sandbox.js.map