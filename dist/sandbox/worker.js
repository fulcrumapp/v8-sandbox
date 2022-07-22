"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const NativeSandbox = require('bindings')('sandbox').Sandbox;
const RUNTIME = fs_1.default.readFileSync(path_1.default.join(__dirname, 'runtime.js')).toString();
class Worker {
    constructor() {
        this.connected = false;
        this.handleMessage = (message) => {
            switch (message.type) {
                case 'initialize':
                    this.initialize(message);
                    break;
                case 'execute':
                    this.execute(message);
                    break;
                case 'callback':
                    this.callback(message);
                    break;
                case 'cancel':
                    this.cancel(message);
                    break;
                case 'exit':
                    this.exit(message);
                    break;
                default:
                    throw new Error('invalid message');
            }
            this.unref();
        };
        this.beforeExit = (code) => {
            this.finish();
            this.ref();
        };
        this.ref = () => {
            process.channel.ref();
        };
        this.unref = () => {
            process.channel.unref();
        };
        this.native = new NativeSandbox(process.argv[2]);
    }
    initialize({ messageId, template }) {
        this.reset(true);
        this.connect();
        this.messageId = messageId;
        this._execute(RUNTIME);
        this._execute(template);
    }
    execute({ messageId, code, globals }) {
        this.reset(false);
        this.connect();
        this.messageId = messageId;
        if (globals !== '{}') {
            this._execute(`Object.assign(global, ${globals});`);
        }
        this._execute(code);
    }
    _execute(code) {
        return this.native.execute(this.messageId, code);
    }
    reset(force) {
        if (force || !this.native.initialized) {
            this.native.initialize();
            this.native.initialized = true;
        }
    }
    connect() {
        if (this.connected) {
            return;
        }
        this.native.connect();
        this.connected = true;
    }
    disconnect() {
        if (!this.connected) {
            return;
        }
        this.native.disconnect();
        this.connected = false;
        this.messageId = null;
    }
    finish() {
        this.native.finish();
    }
    cancel({ messageId, callbackId }) {
        this.native.cancel(messageId, callbackId);
    }
    callback({ messageId, callbackId, args }) {
        this.native.callback(messageId, callbackId, JSON.stringify(args));
    }
    exit(message) {
        this.disconnect();
        process.off('message', this.handleMessage);
    }
}
exports.default = Worker;
const worker = new Worker();
process.on('beforeExit', worker.beforeExit);
process.on('message', worker.handleMessage);
//# sourceMappingURL=worker.js.map