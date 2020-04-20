"use strict";

var _sandbox = _interopRequireDefault(require("../server/sandbox"));

var _async = _interopRequireDefault(require("async"));

var _assert = _interopRequireDefault(require("assert"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

let globalSandbox = null;

class Worker {
  constructor() {
    _defineProperty(this, "queue", void 0);

    _defineProperty(this, "sandboxOptions", void 0);

    _defineProperty(this, "sandbox", void 0);

    _defineProperty(this, "initialized", void 0);

    _defineProperty(this, "error", void 0);

    _defineProperty(this, "worker", async message => {
      if (message.initialize) {
        await this.onInitialize(message);
      } else {
        await this.onExecute(message);
      }
    });

    _defineProperty(this, "onInitialize", async message => {
      this.sandboxOptions = message;
      await this.create();
    });

    _defineProperty(this, "onExecute", async message => {
      await this.wait();
      await this.execute(message);
    });

    this.queue = _async.default.queue(this.worker, 1);
  }

  create() {
    if (!globalSandbox) {
      globalSandbox = new _sandbox.default(this.sandboxOptions);
    }

    this.sandbox = globalSandbox;
    this.initialized = false;
    return this.initialize();
  }

  async initialize() {
    (0, _assert.default)(!this.initialized);

    try {
      const {
        error
      } = await this.sandbox.initialize();

      if (error) {
        this.error = error;
      }
    } catch (error) {
      this.error = error;
    }

    this.initialized = true;
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

  async execute({
    code,
    timeout,
    globals,
    context
  }) {
    (0, _assert.default)(this.initialized);
    let result;

    if (!this.error) {
      result = await this.sandbox.execute({
        code,
        timeout,
        globals: JSON.parse(globals),
        context: JSON.parse(context)
      });
    } else {
      result = {
        error: this.error,
        output: []
      };
    } // convert native error objects into an object that can be serialized


    if (result.error) {
      result.error = {
        name: result.error.name,
        message: result.error.message,
        stack: result.error.stack,
        ...result.error
      };
    }

    process.send(result); // start creating the next sandbox *after* posting the completion message. This operation happens with coordination from
    // the calling process, but that's OK because we wait for it's initialization.

    setImmediate(() => {
      this.create();
    });
  }

}

const worker = new Worker(); // heartbeat the parent process to make sure this worker process never gets orphaned
// if the parent process is killed with SIGKILL, the atExit() handler never runs, which
// leaves this process around forever.

setInterval(() => {
  if (!process.connected) {
    process.exit();
  }
}, 5000);
process.on('message', message => {
  worker.queue.push(message);
});
//# sourceMappingURL=worker.js.map