"use strict";

var _sandbox = _interopRequireDefault(require("./sandbox"));

var _async = _interopRequireDefault(require("async"));

var _assert = _interopRequireDefault(require("assert"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

global.$exports = {};
let globalSandbox = null;
let globalTemplate = null;

class AsyncSandbox {
  constructor() {
    _defineProperty(this, "worker", async message => {
      if (message.initialize) {
        await this.onInitialize(message);
      } else {
        await this.onExecute(message);
      }
    });

    _defineProperty(this, "onInitialize", async message => {
      if (message.require) {
        Object.assign(global.$exports, require(message.require));
      }

      this.template = `setResult({value: null});\n${message.template || ''}`;
      await this.create();
    });

    _defineProperty(this, "onExecute", async message => {
      await this.wait();
      global.context = JSON.parse(message.context);
      await this.execute(message.code);
    });

    this.queue = _async.default.queue(this.worker, 1);
  }

  create() {
    this.sandbox = new _sandbox.default();
    this.initialized = false;
    return this.initialize();
  }

  async initialize() {
    (0, _assert.default)(!this.initialized);
    await this.sandbox.initialize();
    const result = await this.sandbox.execute(this.template);
    this.initialized = true;
    return result;
  }

  wait() {
    return new Promise((resolve, reject) => {
      const check = () => {
        if (this.initialized) {
          resolve();
        } else {
          setImmediate(check);
        }
      };

      check();
    });
  }

  async execute(code) {
    (0, _assert.default)(this.initialized);
    const result = await this.sandbox.execute(code);
    await this.sandbox.finalize();
    process.send(result); // start creating the next sandbox *after* posting the completion message. This operation happens with coordination from
    // the calling process, but that's OK because we wait for it's initialization.

    setImmediate(() => {
      this.create();
    });
  }

}

const asyncSandbox = new AsyncSandbox();
process.on('message', message => {
  asyncSandbox.queue.push(message);
});
//# sourceMappingURL=worker.js.map