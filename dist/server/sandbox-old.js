"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _util = _interopRequireDefault(require("util"));

var _request = _interopRequireDefault(require("request"));

var _host = _interopRequireDefault(require("./host"));

var _timer = _interopRequireDefault(require("./timer"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

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
    _defineProperty(this, "template", void 0);

    _defineProperty(this, "require", void 0);

    _defineProperty(this, "host", void 0);

    _defineProperty(this, "timers", void 0);

    _defineProperty(this, "syncFunctions", void 0);

    _defineProperty(this, "asyncFunctions", void 0);

    this.template = template || '';
    this.require = require;
    this.timers = {};
    this.setup();
  }

  setup() {
    if (this.host) {
      this.host.kill();
    }

    this.host = new _host.default();
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

  initialize({
    timeout
  } = {
    timeout: null
  }) {
    return this.host.initialize({
      timeout,
      template: this.template
    });
  }

  execute({
    code,
    context,
    timeout
  }) {
    return this.host.execute({
      code,
      context,
      timeout,
      template: this.template
    });
  }

  shutdown(callback) {
    this.clearTimers();
    this.host.shutdown(callback);
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
    fail,
    callback
  }) {
    options = options || {};
    (0, _request.default)(this.processRequestOptions(options), (err, response, body) => {
      if (response && Buffer.isBuffer(response.body)) {
        response.body = body = response.body.toString('base64');
      }

      if (!callback) {
        if (err) {
          fail(err);
        } else {
          respond(response);
        }
      } else {
        callback(err, response, body);
      }
    });

    if (callback) {
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

  processRequestOptions(options) {
    return options;
  }

}

exports.default = Sandbox;
//# sourceMappingURL=sandbox-old.js.map