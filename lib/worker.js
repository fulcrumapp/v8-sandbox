import Sandbox from './sandbox';
import async from 'async';
import assert from 'assert';

global.$exports = {};

let globalSandbox = null;
let globalTemplate = null;

class AsyncSandbox {
  constructor()  {
    this.queue = async.queue(this.worker, 1);
  }

  create() {
    this.sandbox = new Sandbox();
    this.initialized = false;

    return this.initialize();
  }

  async initialize() {
    assert(!this.initialized);

    await this.sandbox.initialize();

    const result = await this.sandbox.execute(this.template);

    this.initialized = true;

    return result;
  };

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
    assert(this.initialized);

    const result = await this.sandbox.execute(code);

    await this.sandbox.finalize();

    process.send(result);

    // start creating the next sandbox *after* posting the completion message. This operation happens with coordination from
    // the calling process, but that's OK because we wait for it's initialization.
    setImmediate(() => { this.create(); });
  }

  worker = async (message) => {
    if (message.initialize) {
      await this.onInitialize(message);
    } else {
      await this.onExecute(message);
    }
  }

  onInitialize = async (message) => {
    if (message.require) {
      Object.assign(global.$exports, require(message.require));
    }

    this.template = `setResult({value: null});\n${message.template ||  ''}`;

    await this.create();
  }

  onExecute = async (message) => {
    await this.wait();

    global.context = JSON.parse(message.context);

    await this.execute(message.code);
  }
}

const asyncSandbox = new AsyncSandbox();

process.on('message', (message) => {
  asyncSandbox.queue.push(message);
});
