import path from 'path';
import net from 'net';
import fs from 'fs';
import { fork, ChildProcess } from 'child_process';
import async from 'async';
import { once } from 'lodash';
import onExit from 'signal-exit';
import Timer from './timer';
import Socket from './socket';
import Functions from './functions';

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
  globals?: object;
  context?: object;
  output: Log[];
  timeout: number;
  callback: Function;
}

export interface Options {
  require?: string;
  template?: string;
  httpEnabled?: boolean;
  timersEnabled?: boolean;
  memory?: number;
  argv?: string[];
  debug?: boolean;
}

export interface ExecutionOptions {
  code: string;
  timeout?: number;
  globals?: object;
  context?: object;
}

export class TimeoutError extends Error {
  get isTimeout() {
    return true;
  }
}

let nextID = 0;

export default class Sandbox {
  id: string;

  template: string;

  initializeTimeout: Timer;

  argv: string[];

  executeTimeout: Timer;

  server: net.Server;

  worker: ChildProcess;

  initialized: boolean;

  socket: Socket;

  queue: async.AsyncQueue<Message>;

  message: Message;

  functions: Functions;

  running: boolean;

  debug: boolean;

  memory: number;

  constructor({ require, template, httpEnabled, timersEnabled, memory, argv, debug }: Options = {}) {
    this.id = `v8-sandbox-${ process.pid }-${ ++nextID }`;

    this.initializeTimeout = new Timer();
    this.executeTimeout = new Timer();
    this.memory = memory;
    this.argv = argv ?? [];
    this.debug = debug ?? false;

    this.template = template || '';
    this.functions = new Functions(this, { require, httpEnabled, timersEnabled });

    this.start();

    onExit((code, signal) => {
      this.shutdown();
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

  async execute({ code, timeout, globals, context }: ExecutionOptions) {
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
        globals: globals || {},
        context: context || {},
        output: [],
        callback: (res: Result) => {
          this.initialized = false;

          resolve(res);
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

    const execArgv = [ ...this.argv ];

    if (this.memory) {
      execArgv.push(`--max-old-space-size=${this.memory}`);
    }

    const workerPath = path.join(__dirname, '..', 'client', 'worker');

    this.worker = fork(workerPath, [ this.socketName ], { execArgv });

    this.worker.on('error', (error) => {
      this.fork();
      this.finish({ error });
    });

    this.worker.on('exit', () => {
      if (this.running) {
        this.fork();
      }

      this.finish({ error: new Error('worker exited') });
    });
  }

  kill() {
    this.initializeTimeout.clear();
    this.executeTimeout.clear();

    if (this.worker) {
      this.worker.removeAllListeners();

      if (this.worker.connected) {
        this.worker.send({ type: 'exit' });
      }

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
    this.running = true;

    if (this.server) {
      return;
    }

    this.shutdown();

    this.server = net.createServer();
    this.server.on('connection', this.handleConnection);
    this.server.on('error', this.handleError);

    this.cleanupSocket();

    this.server.listen(this.socketName);

    this.queue = async.queue(this.processMessage, 1);

    this.fork();
  }

  shutdown() {
    return new Promise(resolve => {
      this.running = false;

      this.functions.clearTimers();

      this.kill();

      if (this.socket) {
        this.socket.shutdown();
        this.socket = null;
      }

      if (this.server) {
        this.server.close(resolve);

        this.cleanupSocket();

        this.server = null;
      }
    });
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

  onExecute({ code, timeout, globals, context }: Message) {
    this.executeTimeout.start(timeout, this.handleTimeout);

    this.worker.send({ type: 'execute', code, globals: JSON.stringify(globals) });
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
