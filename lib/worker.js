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

  initialize() {
    assert(!this.initialized);

    return new Promise((resolve, reject) => {
      this.sandbox.initialize(() => {
        this.sandbox.execute(this.template, (err, value) => {
          this.initialized = true;

          err ? reject(err) : resolve(value);
        });
      });
    });
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

  execute(code) {
    assert(this.initialized);

    return new Promise((resolve, reject) => {
      this.sandbox.execute(code, (err, value) => {
        this.sandbox.finalize(() => {
          process.send({err, value});

          err ? reject(err) : resolve(value);

          // start creating the next sandbox *after* posting the completion message. This operation happens with coordination from
          // the calling process, but that's OK because we wait for it's initialization.
          this.create();
        });
      });
    });
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
