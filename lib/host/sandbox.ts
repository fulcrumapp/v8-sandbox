import path from 'path';
import net from 'net';
import fs from 'fs';
import os from 'os';
import { fork, ChildProcess } from 'child_process';
import { randomInt } from 'crypto';
import { onExit } from 'signal-exit';
import once from '../once';
import Queue from '../queue';

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
  isHost?: boolean;
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
  result?: Result | null;
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

export class HostError extends Error {
  get isHost() {
    return true;
  }
}

export class TimeoutError extends HostError {
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

  queue?: Queue<Message>;

  message?: Message;

  functions: Functions;

  running: boolean = false;

  debug: boolean = false;

  memory: number | null;

  uid: number | null;

  gid: number | null;

  socketPath: string | null;

  privateSocketDir: string | null = null;

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
    this.socketPath = socketPath ?? null;
    this.debug = debug ?? false;

    this.template = template || '';
    this.functions = new Functions(this, { require, httpEnabled, timersEnabled });

    this.start();

    onExit((code, signal) => {
      this.shutdown();
    });
  }

  initialize({ timeout } = { timeout: null }): Promise<Result> {
    this.functions.setup();

    return new Promise<Result>((resolve) => {
      this.queue.push({
        id: nextMessageId(),
        type: 'initialize',
        template: [this.functions.defines().join('\n'), this.template].join('\n').trim(),
        timeout,
        output: [],
        result: null,
        callback: (result: Result) => {
          resolve(result);
        },
      });
    });
  }

  async execute({
    code, timeout, globals, context,
  }: ExecutionOptions): Promise<Result> {
    this.start();
    this.functions.setup();

    return new Promise<Result>((resolve) => {
      this.queue.push({
        id: nextMessageId(),
        type: 'execute',
        template: [this.functions.defines().join('\n'), this.template].join('\n').trim(),
        code,
        timeout,
        globals: globals ?? {},
        context: context ?? {},
        output: [],
        result: null,
        callback: (res: Result) => {
          resolve(res);
        },
      });
    });
  }

  get socketDir() {
    if (this.socketPath) {
      return this.socketPath;
    }

    if (!this.privateSocketDir) {
      this.privateSocketDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v8-sandbox-'));
      if (process.platform !== 'win32') {
        if (this.uid != null || this.gid != null) {
          fs.chownSync(this.privateSocketDir, this.uid ?? -1, this.gid ?? -1);
          fs.chmodSync(this.privateSocketDir, this.uid != null ? 0o700 : 0o750);
        } else {
          fs.chmodSync(this.privateSocketDir, 0o700);
        }
      }
    }

    return this.privateSocketDir;
  }

  get socketName() {
    return process.platform === 'win32' ? path.join('\\\\?\\pipe', process.cwd(), this.id)
      : path.join(this.socketDir, this.id);
  }

  dispatch(messageId, invocation, {
    fail, respond, callback, cancel,
  }) {
    if (messageId !== this.message.id) {
      throw new HostError('invalid dispatch');
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

      this.finish({ error: new HostError('worker exited') });
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

  removeSocketPaths(socketFile: string | null, privateDir: string | null) {
    if (socketFile) {
      try {
        fs.unlinkSync(socketFile);
      } catch (ex) {
        // silent
      }
    }

    if (privateDir) {
      try {
        fs.rmSync(privateDir, { recursive: true, force: true });
      } catch (ex) {
        // silent
      }
    }
  }

  cleanupSocket(removePrivateDir = false) {
    const socketFile = this.socketPath || this.privateSocketDir ? this.socketName : null;
    const privateDir = removePrivateDir ? this.privateSocketDir : null;

    if (removePrivateDir) {
      this.privateSocketDir = null;
    }

    this.removeSocketPaths(socketFile, privateDir);
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

    this.server.listen(this.socketName, () => {
      if (process.platform !== 'win32' && (this.uid != null || this.gid != null)) {
        try {
          fs.chownSync(this.socketName, this.uid ?? -1, this.gid ?? -1);
          fs.chmodSync(this.socketName, this.uid != null ? 0o600 : 0o660);
        } catch (ex) {
          // silent
        }
      }
    });

    this.queue = new Queue(this.processMessage, 1);

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
        const oldServer = this.server;
        const oldSocket = this.socketPath || this.privateSocketDir ? this.socketName : null;
        const oldPrivateDir = this.privateSocketDir;

        this.server = null;
        this.privateSocketDir = null;

        this.removeSocketPaths(oldSocket, oldPrivateDir);

        oldServer.close(() => {
          this.removeSocketPaths(null, oldPrivateDir);
          resolve(undefined);
        });
      } else {
        this.cleanupSocket(true);
        resolve(undefined);
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
        ...args[0],
        name: args[0].name,
        message: args[0].message,
        ...(this.debug ? { stack: args[0].stack } : {}),
      };
    }

    this.worker.send({
      messageId, type: 'callback', callbackId, args,
    });
  }

  cancel(messageId, callbackId) {
    this.worker.send({ messageId, type: 'cancel', callbackId });
  }

  runSinglePhase(message: Message, trigger: () => void): Promise<Result> {
    this.message = message;

    return new Promise<Result>((resolve) => {
      this.message.callback = once((result) => {
        resolve(result);
      });

      trigger();
    });
  }

  processMessage = async (message: Message) => {
    const outerCallback = message.callback;

    if (message.type === 'initialize') {
      const result = await this.runSinglePhase(message, () => this.onInitialize(message));
      if (!result?.error) {
        this.initialized = true;
      }
      outerCallback(result);
      return;
    }

    if (message.type === 'execute') {
      if (!this.initialized) {
        const initMessage: Message = {
          id: nextMessageId(),
          type: 'initialize',
          template: message.template,
          timeout: message.timeout,
          output: [],
          result: null,
          callback: () => {},
        };

        const initResult = await this.runSinglePhase(initMessage, () => this.onInitialize(initMessage));

        if (initResult?.error) {
          this.initialized = false;
          outerCallback(initResult);
          return;
        }

        this.initialized = true;
      }

      const execResult = await this.runSinglePhase(message, () => this.onExecute(message));
      this.initialized = false;
      outerCallback(execResult);
      return;
    }

    const result = await this.runSinglePhase(message, () => {
      this.finish({ error: new HostError('invalid message') });
    });
    outerCallback(result);
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
    if (this.message) {
      this.message.result = result;
    }
  }

  finish(result) {
    const rawResult = result ?? this.message?.result;
    let finishResult = rawResult;

    if (rawResult?.error?.isHost && !this.debug) {
      const err = rawResult.error;
      const sanitized: Record<string, any> = {
        name: err.name,
        message: err.message,
        isHost: true,
        ...(err.isTimeout ? { isTimeout: true } : {}),
        ...(err.code ? { code: err.code } : {}),
      };
      finishResult = { ...rawResult, error: sanitized };
    }

    this.functions.clearTimers();

    if (this.message) {
      this.message.callback({ ...finishResult, output: this.message.output });
    }
  }

  handleConnection = (socket) => {
    if (this.socket && this.socket.isConnected) {
      socket.destroy();
      return;
    }

    this.socket = new Socket(socket, this);
  };

  handleError = (error) => {
    console.error('server error', error);
  };
}
