import path from 'path';
import net from 'net';
import fs from 'fs';
import { fork, ChildProcess } from 'child_process';
import Timer from './timer';
import Socket from './socket';
import Functions from './functions';
import async from 'async';
import { once } from 'lodash';
import onExit from 'signal-exit';

export interface Log {
  type: string;
  time: Date;
  message: string;
}

export interface Result {
  value?: any;
  error?: {
    name: string;
    message: string;
    stack: string;
  };
  output?: Log[];
}

export interface Message {
  type: 'initialize' | 'execute';
  template?: string;
  code?: string;
  context?: any;
  output: Log[];
  timeout: number;
  callback: Function;
}

class TimeoutError extends Error {
  get isTimeout() {
    return true;
  }
}

let nextID = 0;

export default class Sandbox {
  id: string;

  template: string;

  initializeTimeout: Timer;

  executeTimeout: Timer;

  server: net.Server;

  worker: ChildProcess;

  initialized: boolean;

  socket: Socket;

  queue: async.AsyncQueue<Message>;

  message: Message;

  functions: Functions;

  constructor({ require, template } = { require: null, template: null }) {
    this.id = `v8-sandbox-${ process.pid }-${ ++nextID }`;

    this.initializeTimeout = new Timer();
    this.executeTimeout = new Timer();

    this.template = template || '';
    this.functions = new Functions(this, { require });

    this.start();

    onExit((code, signal) => {
      this.shutdown(null);
    });
  }

  initialize({ timeout } = { timeout: null }): Promise<Result> {
    return new Promise(resolve => {
      this.queue.push({
        type: 'initialize',
        template: [ this.functions.defines().join('\n'), this.template ].join('\n'),
        timeout,
        output: [],
        callback: (result: Result) => {
          this.initialized = true;

          resolve(result);
        }
      });
    });
  }

  async execute({ code, context, timeout }) {
    this.start();

    const result = await this.initialize({ timeout });

    if (result.error) {
      return result;
    }

    return new Promise(resolve => {
      this.queue.push({
        type: 'execute',
        code,
        timeout,
        context: context || {},
        output: [],
        callback: (result: Result) => {
          this.initialized = false;

          resolve(result);
        }
      });
    });
  }

  get socketName() {
    return process.platform === 'win32' ? path.join('\\\\?\\pipe', process.cwd(), this.id)
      : `/tmp/${ this.id }`;
  }

  dispatch(invocation, { fail, respond, callback }) {
    this.functions.dispatch(invocation, { message: this.message, fail, respond, callback });
  }

  fork() {
    this.kill();

    this.worker = fork(path.join(__dirname, '..', 'client', 'worker'), [ this.socketName ]);

    this.worker.on('error', (error) => {
      this.fork();
      this.finish({ error });
    });
  }

  kill() {
    this.initializeTimeout.clear();
    this.executeTimeout.clear();

    if (this.worker) {
      this.worker.removeAllListeners();
      this.worker.send({ type: 'exit' });
      this.worker.kill();
      this.worker = null;
      this.initialized = false;
    }
  }

  cleanupSocket() {
    try {
      fs.unlinkSync(this.socketName);
    } catch (ex) {
      // silent
    }
  }

  start() {
    if (this.server) {
      return;
    }

    this.shutdown(null);

    this.server = net.createServer();
    this.server.on('connection', this.handleConnection);
    this.server.on('error', this.handleError);

    this.cleanupSocket();

    this.server.listen(this.socketName);

    this.queue = async.queue(this.processMessage, 1);

    this.fork();
  }

  shutdown(callback) {
    this.functions.clearTimers();

    this.kill();

    if (this.socket) {
      this.socket.shutdown();
      this.socket = null;
    }

    if (this.server) {
      this.server.close(() => {
        this.cleanupSocket();

        if (callback) {
          callback();
        }
      });

      this.server = null;
    }
  }

  handleTimeout = () => {
    this.fork();
    this.finish({ error: new TimeoutError(`timeout: ${this.message.timeout }ms`) });
  };

  callback(id, args) {
    this.worker.send({ type: 'callback', id, args });
  }

  processMessage = async (message: Message) => {
    this.message = message;

    return new Promise(resolve => {
      const { callback } = this.message;

      this.message.callback = once((result) => {
        callback(result);
        resolve();
      });

      switch (message.type) {
        case 'initialize':
          return this.onInitialize(message);
        case 'execute':
          return this.onExecute(message);
        default:
          this.finish({ error: new Error('invalid message') });
      }
    });
  };

  onInitialize({ template, timeout }: Message) {
    if (this.initialized) {
      return this.finish({});
    }

    this.initializeTimeout.start(timeout, this.handleTimeout);

    this.worker.send({ type: 'initialize', template });
  }

  onExecute({ code, context, timeout }: Message) {
    this.executeTimeout.start(timeout, this.handleTimeout);

    global.context = context;

    this.worker.send({ type: 'execute', code, context: JSON.stringify(context) });
  }

  finish(result) {
    this.functions.clearTimers();

    if (this.message) {
      this.message.callback({ ...result, output: this.message.output });
    }
  }

  handleConnection = (socket) => {
    this.socket = new Socket(socket, this);
  };

  handleError = (error) => {
    console.error('server error', error);
  };
}
