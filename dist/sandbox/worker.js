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
                    return this.initialize(message);
                case 'execute':
                    return this.execute(message);
                case 'callback':
                    return this.callback(message);
                case 'exit':
                    return this.exit(message);
                default:
                    throw new Error('invalid message');
            }
        };
        this.native = new NativeSandbox(process.argv[2]);
    }
    initialize({ template }) {
        this.reset(true);
        this.connect();
        this._execute(RUNTIME);
        this._execute(template);
        this._execute('setResult()');
    }
    execute({ code, globals }) {
        this.reset(false);
        this.connect();
        if (globals !== '{}') {
            this._execute(`Object.assign(global, ${globals});`);
        }
        this._execute(code);
    }
    _execute(code) {
        return this.native.execute(code);
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
    }
    callback({ id, args }) {
        this.native.callback(id, JSON.stringify(args));
    }
    exit(message) {
        this.disconnect();
        process.off('message', this.handleMessage);
    }
}
exports.default = Worker;
const worker = new Worker();
process.on('message', worker.handleMessage);
//# sourceMappingURL=worker.js.map