"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _fs = _interopRequireDefault(require("fs"));

var _path = _interopRequireDefault(require("path"));

var _request = _interopRequireDefault(require("request"));

var _util = _interopRequireDefault(require("util"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

const NativeSandbox = require('bindings')('sandbox').Sandbox;

const RUNTIME = _fs.default.readFileSync(_path.default.join(__dirname, 'runtime.js')).toString();

const LINECOUNT = RUNTIME.split('\n').length;

function tryParseJSON(value) {
  try {
    return JSON.parse(value);
  } catch (ex) {
    return null;
  }
}

const SYNC_FUNCTIONS = {};
const ASYNC_FUNCTIONS = {};
const BLOCKING_FUNCTIONS = {};
const BLOCKING = Symbol('v8-sandbox-blocking');

class Sandbox {
  constructor({
    require,
    template
  } = {}) {
    this.native = new NativeSandbox();
    this.require = require;
    this.template = template;
    this.load();
  }

  load() {
    global.define = this.define.bind(this);
    global.defineAsync = this.defineAsync.bind(this);
    global.defineBlocking = this.defineBlocking.bind(this);
    this.syncFunctions = {};
    this.asyncFunctions = {};
    this.blockingFunctions = {};

    if (this.require) {
      this.syncFunctions = SYNC_FUNCTIONS[this.require] = SYNC_FUNCTIONS[this.require] || {};
      this.asyncFunctions = ASYNC_FUNCTIONS[this.require] = ASYNC_FUNCTIONS[this.require] || {};
      this.blockingFunctions = BLOCKING_FUNCTIONS[this.require] = BLOCKING_FUNCTIONS[this.require] || {};

      require(this.require);
    }
  }

  define(name, fn) {
    this.syncFunctions[name] = fn;
  }

  defineAsync(name, fn) {
    this.asyncFunctions[name] = fn;
  }

  defineBlocking(name, fn) {
    this.blockingFunctions[name] = (...args) => {
      fn(...args);
      return BLOCKING;
    };
  }

  defines() {
    return [...Object.entries(this.syncFunctions).map(([name, fn]) => `define('${name}');\n`), ...Object.entries(this.asyncFunctions).map(([name, fn]) => `defineAsync('${name}');\n`), ...Object.entries(this.blockingFunctions).map(([name, fn]) => `defineBlocking('${name}');\n`)];
  }

  initialize() {
    return new Promise((resolve, reject) => {
      this.output = [];
      const defines = this.defines();
      const code = RUNTIME + '\n' + this.defines().join('\n') + this.template;
      this.native.initialize(code, json => {
        const result = tryParseJSON(json);
        setImmediate(() => {
          if (result && result.error) {
            if (result.error.lineNumber != null) {
              result.error.lineNumber -= LINECOUNT + defines.length;
            }

            reject(result.error);
          } else {
            resolve(result && result.value);
          }
        });
      }, this.dispatch.bind(this));
    });
  }

  async eval(code) {
    await this.initialize();
    const result = await this.execute(code);
    await this.finalize();
    return { ...result,
      output: this.output
    };
  }

  execute(code, callback) {
    return new Promise((resolve, reject) => {
      this.native.execute(code, json => {
        let result = tryParseJSON(json);

        if (result == null) {
          result = {
            error: new Error('no result'),
            output: this.output
          };
        }

        setImmediate(() => {
          resolve({ ...result,
            output: this.output
          });
        });
      }, this.dispatch.bind(this));
    });
  }

  finalize() {
    return new Promise(resolve => {
      this.native.finalize(() => {
        setImmediate(resolve);
      }, this.dispatch.bind(this));
    });
  } // handle function calls from the sandbox


  dispatch(invocation) {
    const finish = (err, ...results) => {
      const serialized = [err != null ? {
        message: err.message
      } : null];

      if (results && results.length) {
        serialized.push.apply(serialized, results);
      }

      invocation.callback(invocation, JSON.stringify(serialized));
    };

    const parameters = tryParseJSON(invocation.args);

    if (parameters == null) {
      return finish(new Error('invalid invocation parameters'));
    }

    if (invocation.name === 'dispatchSync') {
      return this.dispatchSync(parameters, finish);
    } else if (invocation.name === 'dispatchAsync') {
      return this.dispatchAsync(parameters, finish);
    } else if (invocation.name === 'httpRequest') {
      return this.httpRequest(...parameters, finish);
    } else if (invocation.name === 'log') {
      this.log(...parameters);
      return finish(null);
    } else if (invocation.name === 'error') {
      this.error(...parameters);
      return finish(null);
    }

    return finish(null);
  }

  log(...args) {
    this.write({
      type: 'log',
      args
    });
    console.log(...args);
  }

  error(...args) {
    this.write({
      type: 'error',
      args
    });
    console.error(...args);
  }

  write({
    type,
    args
  }) {
    this.output.push({
      type,
      time: new Date(),
      message: _util.default.format(...args)
    });
  }

  httpRequest(options, callback) {
    (0, _request.default)(options, (err, response, body) => {
      if (response && Buffer.isBuffer(response.body)) {
        response.body = body = response.body.toString('base64');
      }

      callback(err, response, body);
    });
  }

  dispatchSync(args, callback) {
    try {
      const name = args[0];
      const parameters = args.slice(1);
      const fn = name && (this.syncFunctions[name] || this.blockingFunctions[name]);

      if (!fn) {
        return callback(new Error(`function named '${name}' does not exist`));
      }

      const result = fn(...[...parameters, callback]);

      if (result !== BLOCKING) {
        callback(null, result);
      }
    } catch (err) {
      callback(err);
    }
  }

  dispatchAsync(args, callback) {
    try {
      const name = args[0];
      const parameters = args.slice(1);
      const fn = name && this.asyncFunctions[name];

      if (!fn) {
        return callback(new Error(`function named '${name}' does not exist`));
      }

      fn(...[...parameters, callback]);
    } catch (err) {
      callback(err);
    }
  }

}

exports.default = Sandbox;
//# sourceMappingURL=sandbox.js.map