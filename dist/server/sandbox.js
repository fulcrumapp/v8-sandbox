"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _path = _interopRequireDefault(require("path"));

var _net = _interopRequireDefault(require("net"));

var _request = _interopRequireDefault(require("request"));

var _socket = _interopRequireDefault(require("./socket"));

var _host = _interopRequireDefault(require("./host"));

var _lodash = require("lodash");

var _uuid = require("uuid");

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

  execute({
    code,
    context,
    timeout
  }, callback) {
    this.queue.push({
      code,
      context: context || {},
      timeout,
      callback: (0, _lodash.once)(callback)
    });

    if (!this.item) {
      this.next();
    }
  }

  next() {
    this.item = null;

    if (this.queue.length === 0) {
      return;
    }

    const item = this.item = this.queue.pop();
    this.host.removeAllListeners();
    this.host.on('error', error => {
      console.error('worker:error', error);
      item.callback({
        error: new Error('worker error')
      });
      this.next();
    });
    this.host.on('timeout', () => {
      item.callback({
        error: new TimeoutError('timeout')
      });
      this.next();
    });
    this.host.execute(item);
  }

  shutdown(callback) {
    this.host.kill();

    if (this.socket) {
      this.socket.shutdown();
    }

    this.server.close(callback);
  }

  dispatch({
    name,
    args
  }, respond, callback) {
    const params = [...args, respond, callback];

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

      default:
        {
          throw new Error(`${name} is not a valid method`);
        }
    }
  }

  setResult(result, respond, callback) {
    this.item.callback(result);
    respond({
      value: null
    });
    this.next();
  }

  setTimeout(timeout, respond, callback) {
    const timerID = setTimeout(callback, timeout);
    respond({
      value: +timerID
    });
  }

  clearTimeout(timerID, respond, callback) {
    clearTimeout(timerID);
    respond({
      value: null
    });
  }

  httpRequest(options, respond, callback) {
    const {
      sync
    } = options;
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
      respond({
        value: null
      });
    }
  }

}

exports.default = Sandbox;
//# sourceMappingURL=sandbox.js.map