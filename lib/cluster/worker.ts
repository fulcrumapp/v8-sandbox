import assert from 'assert';
import Sandbox, { Options } from '../host/sandbox';
import Queue from '../queue';

let globalSandbox: Sandbox | null = null;

interface Message {
  initialize: boolean;
  require?: string;
  template?: string;
  code: string;
  globals: string;
  context: string;
  timeout: number;
}

class Worker {
  queue: Queue<Message>;

  sandboxOptions?: Options;

  sandbox?: Sandbox;

  initialized: boolean = false;

  error: any;

  constructor() {
    this.queue = new Queue(this.worker, 1);
  }

  create() {
    if (!globalSandbox) {
      globalSandbox = new Sandbox(this.sandboxOptions);
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
    } catch (error) {
      this.error = error;
    }

    this.initialized = true;
  }

  wait() {
    return new Promise<void>((resolve, reject) => {
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
    code, timeout, globals, context,
  }: Message) {
    assert(this.initialized);

    let result;

    if (!this.error) {
      result = await this.sandbox.execute({
        code,
        timeout,
        globals: JSON.parse(globals),
        context: JSON.parse(context),
      });
    } else {
      result = { error: this.error, output: [] };
    }

    // convert native error objects into an object that can be serialized
    if (result.error) {
      const includeStack = !result.error.isHost || Boolean(this.sandboxOptions?.debug);
      const serializedError: Record<string, any> = {
        name: result.error.name,
        message: result.error.message,
        isHost: result.error.isHost,
        ...result.error,
      };
      if (includeStack && result.error.stack !== undefined) {
        serializedError.stack = result.error.stack;
      } else {
        delete serializedError.stack;
      }
      result.error = serializedError;
    }

    process.send(result);

    // start creating the next sandbox *after* posting the completion message. This operation
    // happens with coordination from the calling process, but that's OK because we wait for
    // it's initialization.
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
    this.sandboxOptions = message;

    await this.create();
  };

  onExecute = async (message: Message) => {
    await this.wait();

    await this.execute(message);
  };
}

const worker = new Worker();

// heartbeat the parent process to make sure this worker process never gets orphaned
// if the parent process is killed with SIGKILL, the atExit() handler never runs, which
// leaves this process around forever.
setInterval(() => {
  if (!process.connected) {
    process.exit();
  }
}, 1000);

process.on('message', (message) => {
  worker.queue.push(message as Message);
});
