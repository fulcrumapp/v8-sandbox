import path from 'path';
import net from 'net';
import fs from 'fs';
import { fork, ChildProcess } from 'child_process';
import { randomInt } from 'crypto';
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

export interface ExecutionError {
  name: string;
  message: string;
  stack: string;
  exception: any;
  lineNumber: number;
  startColumn: number;
  endColumn: number;
  startPosition: number;
  endPosition: number;
  sourceLine: string;
  isTimeout?: boolean;
  code?: string;
}

export interface Result {
  value?: any;
  error?: ExecutionError;
  output?: Log[];
}

export interface Message {
  id: number;
  type: 'initialize' | 'execute';
  template?: string;
  code?: string;
  globals?: object;
  context?: object;
  output: Log[];
  timeout?: number;
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
  uid?: number;
  gid?: number;
  socketPath?: string;
}

export interface ExecutionOptions {
  code: string;
  timeout?: number;
  globals?: object;
  context?: object;
}

export class TimeoutError extends Error {
  constructor(timeout: number) {
    super(`timeout: ${timeout}ms`);
  }

  get isTimeout() {
    return true;
  }
}

let nextId = 0;

const nextSandboxId = () => `v8-sandbox-${process.pid}-${++nextId}`;

const nextMessageId = () => randomInt(2 ** 30);

export default class Sandbox {
  id: string;

  template: string;

  initializeTimeout: Timer;

  argv: string[];

  executeTimeout: Timer;

  server?: net.Server;

  worker?: ChildProcess;

  initialized: boolean = false;

  socket?: Socket;

  queue?: async.QueueObject<Message>;

  message?: Message;

  functions: Functions;

  running: boolean = false;

  debug: boolean = false;

  memory: number | null;

  uid: number | null;

  gid: number | null;

  socketPath: string;

  result: Result;

  constructor({
    require, template, httpEnabled, timersEnabled, memory, argv, uid, gid, debug, socketPath,
  }: Options = {}) {
    this.id = nextSandboxId();

    this.initializeTimeout = new Timer();
    this.executeTimeout = new Timer();
    this.memory = memory ?? null;
    this.argv = argv ?? [];
    this.uid = uid ?? null;
    this.gid = gid ?? null;
    this.socketPath = socketPath ?? '/tmp';
    this.debug = debug ?? false;

    this.template = template || '';
    this.functions = new Functions(this, { require, httpEnabled, timersEnabled });

    this.start();

    onExit((code, signal) => {
      this.shutdown();
    });
  }

  initialize({ timeout } = { timeout: null }): Promise<Result> {
    this.setResult(null);

    return new Promise<Result>((resolve) => {
      this.queue.push({
        id: nextMessageId(),
        type: 'initialize',
        template: [this.functions.defines().join('\n'), this.template].join('\n').trim(),
        timeout,
        output: [],
        callback: (result: Result) => {
          this.initialized = true;

          resolve(result);
        },
      });
    });
  }

  async execute({
    code, timeout, globals, context,
  }: ExecutionOptions): Promise<Result> {
    this.start();

    const result = await this.initialize({ timeout });

    if (result.error) {
      return result;
    }

    return new Promise<Result>((resolve) => {
      this.queue.push({
        id: nextMessageId(),
        type: 'execute',
        code,
        timeout,
        globals: globals ?? {},
        context: context ?? {},
        output: [],
        callback: (res: Result) => {
          this.initialized = false;

          resolve(res);
        },
      });
    });
  }

  get socketName() {
    return process.platform === 'win32' ? path.join('\\\\?\\pipe', process.cwd(), this.id)
      : `${this.socketPath}/${this.id}`;
  }

  dispatch(messageId, invocation, {
    fail, respond, callback, cancel,
  }) {
    if (messageId !== this.message.id) {
      throw new Error('invalid dispatch');
    }

    this.functions.dispatch(invocation, {
      message: this.message, fail, respond, callback, cancel,
    });
  }

  fork() {
    this.kill();

    const execArgv = [...this.argv];

    if (this.memory) {
      execArgv.push(`--max-old-space-size=${this.memory}`);
    }

    const workerPath = path.join(__dirname, '..', 'sandbox', 'worker');

    this.worker = fork(workerPath, [this.socketName], { execArgv, uid: this.uid, gid: this.gid });

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
    return new Promise((resolve) => {
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
    this.finish({ error: new TimeoutError(this.message.timeout) });
  };

  callback(messageId, callbackId, args) {
    if (args && args.length > 0 && args[0] instanceof Error) {
      args[0] = {
        name: args[0].name,
        message: args[0].message,
        stack: args[0].stack,
      };
    }

    this.worker.send({
      messageId, type: 'callback', callbackId, args,
    });
  }

  cancel(messageId, callbackId) {
    this.worker.send({ messageId, type: 'cancel', callbackId });
  }

  processMessage = async (message: Message) => {
    this.message = message;

    return new Promise<void>((resolve) => {
      const { callback } = this.message;

      this.message.callback = once((result) => {
        callback(result);
        resolve();
      });

      switch (message.type) {
        case 'initialize':
          this.onInitialize(message);
          break;
        case 'execute':
          this.onExecute(message);
          break;
        default:
          this.finish({ error: new Error('invalid message') });
      }
    });
  };

  onInitialize({ id, template, timeout }: Message) {
    if (this.initialized) {
      this.finish({});
      return;
    }

    this.initializeTimeout.start(timeout, this.handleTimeout);

    this.worker.send({ messageId: id, type: 'initialize', template });
  }

  onExecute({
    id, code, timeout, globals, context,
  }: Message) {
    this.executeTimeout.start(timeout, this.handleTimeout);

    this.worker.send({
      messageId: id, type: 'execute', code, globals: JSON.stringify(globals),
    });
  }

  setResult(result) {
    this.result = result;
  }

  finish(result) {
    const finishResult = result ?? this.result;

    this.functions.clearTimers();

    if (this.message) {
      this.message.callback({ ...finishResult, output: this.message.output });
    }
  }

  handleConnection = (socket) => {
    this.socket = new Socket(socket, this);
  };

  handleError = (error) => {
    console.error('server error', error);
  };
}
