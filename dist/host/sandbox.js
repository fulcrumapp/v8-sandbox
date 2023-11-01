"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TimeoutError = exports.HostError = void 0;
const path_1 = __importDefault(require("path"));
const net_1 = __importDefault(require("net"));
const fs_1 = __importDefault(require("fs"));
const child_process_1 = require("child_process");
const crypto_1 = require("crypto");
const async_1 = __importDefault(require("async"));
const lodash_1 = require("lodash");
const signal_exit_1 = require("signal-exit");
const timer_1 = __importDefault(require("./timer"));
const socket_1 = __importDefault(require("./socket"));
const functions_1 = __importDefault(require("./functions"));
class HostError extends Error {
    get isHost() {
        return true;
    }
}
exports.HostError = HostError;
class TimeoutError extends HostError {
    constructor(timeout) {
        super(`timeout: ${timeout}ms`);
    }
    get isTimeout() {
        return true;
    }
}
exports.TimeoutError = TimeoutError;
let nextId = 0;
const nextSandboxId = () => `v8-sandbox-${process.pid}-${++nextId}`;
const nextMessageId = () => (0, crypto_1.randomInt)(2 ** 30);
class Sandbox {
    constructor({ require, template, httpEnabled, timersEnabled, memory, argv, uid, gid, debug, socketPath, } = {}) {
        this.initialized = false;
        this.running = false;
        this.debug = false;
        this.handleTimeout = () => {
            this.fork();
            this.finish({ error: new TimeoutError(this.message.timeout) });
        };
        this.processMessage = async (message) => {
            this.message = message;
            return new Promise((resolve) => {
                const { callback } = this.message;
                this.message.callback = (0, lodash_1.once)((result) => {
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
                        this.finish({ error: new HostError('invalid message') });
                }
            });
        };
        this.handleConnection = (socket) => {
            this.socket = new socket_1.default(socket, this);
        };
        this.handleError = (error) => {
            console.error('server error', error);
        };
        this.id = nextSandboxId();
        this.initializeTimeout = new timer_1.default();
        this.executeTimeout = new timer_1.default();
        this.memory = memory ?? null;
        this.argv = argv ?? [];
        this.uid = uid ?? null;
        this.gid = gid ?? null;
        this.socketPath = socketPath ?? '/tmp';
        this.debug = debug ?? false;
        this.template = template || '';
        this.functions = new functions_1.default(this, { require, httpEnabled, timersEnabled });
        this.start();
        (0, signal_exit_1.onExit)((code, signal) => {
            this.shutdown();
        });
    }
    initialize({ timeout } = { timeout: null }) {
        this.setResult(null);
        this.functions.setup();
        return new Promise((resolve) => {
            this.queue.push({
                id: nextMessageId(),
                type: 'initialize',
                template: [this.functions.defines().join('\n'), this.template].join('\n').trim(),
                timeout,
                output: [],
                callback: (result) => {
                    this.initialized = true;
                    resolve(result);
                },
            });
        });
    }
    async execute({ code, timeout, globals, context, }) {
        this.start();
        const result = await this.initialize({ timeout });
        if (result.error) {
            return result;
        }
        return new Promise((resolve) => {
            this.queue.push({
                id: nextMessageId(),
                type: 'execute',
                code,
                timeout,
                globals: globals ?? {},
                context: context ?? {},
                output: [],
                callback: (res) => {
                    this.initialized = false;
                    resolve(res);
                },
            });
        });
    }
    get socketName() {
        return process.platform === 'win32' ? path_1.default.join('\\\\?\\pipe', process.cwd(), this.id)
            : `${this.socketPath}/${this.id}`;
    }
    dispatch(messageId, invocation, { fail, respond, callback, cancel, }) {
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
        const workerPath = path_1.default.join(__dirname, '..', 'sandbox', 'worker');
        this.worker = (0, child_process_1.fork)(workerPath, [this.socketName], { execArgv, uid: this.uid, gid: this.gid });
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
    cleanupSocket() {
        try {
            fs_1.default.unlinkSync(this.socketName);
        }
        catch (ex) {
            // silent
        }
    }
    start() {
        this.running = true;
        if (this.server) {
            return;
        }
        this.shutdown();
        this.server = net_1.default.createServer();
        this.server.on('connection', this.handleConnection);
        this.server.on('error', this.handleError);
        this.cleanupSocket();
        this.server.listen(this.socketName);
        this.queue = async_1.default.queue(this.processMessage, 1);
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
    onInitialize({ id, template, timeout }) {
        if (this.initialized) {
            this.finish({});
            return;
        }
        this.initializeTimeout.start(timeout, this.handleTimeout);
        this.worker.send({ messageId: id, type: 'initialize', template });
    }
    onExecute({ id, code, timeout, globals, context, }) {
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
}
exports.default = Sandbox;
//# sourceMappingURL=sandbox.js.map