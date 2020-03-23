import Sandbox from '../server/sandbox';
import async from 'async';
import assert from 'assert';

let globalSandbox = null;

interface Message {
  initialize: boolean;
  require?: string;
  template?: string;
  code?: string;
  context?: string;
  timeout: string;
}

class Worker {
  require: string;

  template: string;

  queue: async.AsyncQueue<Message>;

  sandbox: Sandbox;

  initialized: boolean;

  error: any;

  constructor() {
    this.queue = async.queue(this.worker, 1);
  }

  create() {
    if (!globalSandbox) {
      globalSandbox = new Sandbox({ require: this.require, template: this.template });
    }

    this.sandbox = globalSandbox;
    this.initialized = false;

    return this.initialize();
  }

  async initialize() {
    assert(!this.initialized);

    try {
      const { error } = await this.sandbox.initialize();

      if (error) {
        this.error = error;
      }
    } catch (ex) {
      this.error = {
        name: ex.name,
        message: ex.message,
        stack: ex.stack
      };
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

  async execute({ code, context, timeout }: Message) {
    assert(this.initialized);

    let result;

    if (!this.error) {
      result = await this.sandbox.execute({ code, timeout, context: JSON.parse(context) });
    } else {
      result = { error: this.error };
    }

    process.send(result);

    // start creating the next sandbox *after* posting the completion message. This operation happens with coordination from
    // the calling process, but that's OK because we wait for it's initialization.
    setImmediate(() => {
      this.create();
    });
  }

  worker = async (message: Message) => {
    if (message.initialize) {
      await this.onInitialize(message);
    } else {
      await this.onExecute(message);
    }
  };

  onInitialize = async (message: Message) => {
    this.require = message.require;
    this.template = message.template;

    await this.create();
  };

  onExecute = async (message: Message) => {
    await this.wait();

    await this.execute(message);
  };
}

const worker = new Worker();

process.on('message', (message) => {
  worker.queue.push(message);
});
