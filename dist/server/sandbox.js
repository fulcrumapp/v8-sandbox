"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _path = _interopRequireDefault(require("path"));

var _net = _interopRequireDefault(require("net"));

var _util = _interopRequireDefault(require("util"));

var _request = _interopRequireDefault(require("request"));

var _lodash = require("lodash");

var _uuid = require("uuid");

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

class Sandbox {
  constructor() {
    _defineProperty(this, "handleConnection", socket => {
      // console.log('server connection');
      this.socket = new _socket.default(socket, this);
    });

    _defineProperty(this, "handleError", error => {
      console.error('server error', error);
    });

    this.id = (0, _uuid.v4)();
    this.server = _net.default.createServer();
    this.server.on('connection', this.handleConnection);
    this.server.on('error', this.handleError);
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
  }

  get socketName() {
    return process.platform === 'win32' ? _path.default.join('\\\\?\\pipe', process.cwd(), this.id) : `/tmp/${this.id}`;
  }

  initialize({
    template,
    timeout
  }) {
    return new Promise(resolve => {
      this.queue.push({
        type: 'initialize',
        template,
        output: [],
        timeout,
        callback: (0, _lodash.once)(resolve)
      });

      if (!this.item) {
        this.next();
      }
    });
  }

  execute({
    code,
    context,
    timeout
  }) {
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

  shutdown(callback) {
    this.host.kill();

    if (this.socket) {
      this.socket.shutdown();
    }

    this.server.close(callback);
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
  }, respond, callback) {
    const params = [args, respond, callback];

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
          throw new Error(`${name} is not a valid method`);
        }
    }
  }

  setResult([result], respond, callback) {
    this.finish(result);
    respond();
    this.next();
  }

  setTimeout([timeout], respond, callback) {
    const timer = new _timer.default();
    timer.start(timeout || 0, callback);
    const id = +timer.id;
    this.timers[id] = timer;
    respond({
      value: id
    });
  }

  clearTimeout(timerID, respond, callback) {
    const timer = this.timers[+timerID];

    if (timer) {
      timer.clear();
      delete this.timers[+timerID];
    }

    respond();
  }

  httpRequest([options], respond, callback) {
    const {
      sync
    } = options || {};
    (0, _request.default)(options, (err, response, body) => {
      if (response && Buffer.isBuffer(response.body)) {
        response.body = body = response.body.toString('base64');
      }

      if (sync) {
        respond({
          value: {
            err,
            response,
            body
          }
        });
      } else {
        callback(err, response, body);
      }
    });

    if (!sync) {
      respond();
    }
  }

  log([args], respond, callback) {
    this.write({
      type: 'log',
      args
    });
    console.log(...args);
    respond();
  }

  error([args], respond, callback) {
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