import Sandbox from './sandbox';
import async from 'async';
import assert from 'assert';

global.$exports = {};

let globalSandbox = null;

class AsyncSandbox {
  constructor()  {
    this.queue = async.queue(this.worker, 1);
  }

  create() {
    this.sandbox = new Sandbox({require: this.require, template: this.template});
    this.initialized = false;

    return this.initialize();
  }

  async initialize() {
    assert(!this.initialized);

    try {
      await this.sandbox.initialize();
    } catch (ex) {
      ex.message = `error initializing sandbox. ${ex.message}`;

      this.error = ex;
    }

    this.initialized = true;
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

    let result;

    if (!this.error)  {
      result = await this.sandbox.execute(code);
    } else {
      result = { error: this.error };
    }

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
    this.require = message.require;
    this.template = message.template;

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
