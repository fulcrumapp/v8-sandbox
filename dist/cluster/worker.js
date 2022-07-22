"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const async_1 = __importDefault(require("async"));
const assert_1 = __importDefault(require("assert"));
const sandbox_1 = __importDefault(require("../host/sandbox"));
let globalSandbox = null;
class Worker {
    constructor() {
        this.initialized = false;
        this.worker = async (message) => {
            if (message.initialize) {
                await this.onInitialize(message);
            }
            else {
                await this.onExecute(message);
            }
        };
        this.onInitialize = async (message) => {
            this.sandboxOptions = message;
            await this.create();
        };
        this.onExecute = async (message) => {
            await this.wait();
            await this.execute(message);
        };
        this.queue = async_1.default.queue(this.worker, 1);
    }
    create() {
        if (!globalSandbox) {
            globalSandbox = new sandbox_1.default(this.sandboxOptions);
        }
        this.sandbox = globalSandbox;
        this.initialized = false;
        return this.initialize();
    }
    async initialize() {
        (0, assert_1.default)(!this.initialized);
        try {
            const { error } = await this.sandbox.initialize();
            if (error) {
                this.error = error;
            }
        }
        catch (error) {
            this.error = error;
        }
        this.initialized = true;
    }
    wait() {
        return new Promise((resolve, reject) => {
            const check = () => {
                if (this.initialized) {
                    resolve();
                }
                else {
                    setImmediate(check);
                }
            };
            check();
        });
    }
    async execute({ code, timeout, globals, context, }) {
        (0, assert_1.default)(this.initialized);
        let result;
        if (!this.error) {
            result = await this.sandbox.execute({
                code,
                timeout,
                globals: JSON.parse(globals),
                context: JSON.parse(context),
            });
        }
        else {
            result = { error: this.error, output: [] };
        }
        // convert native error objects into an object that can be serialized
        if (result.error) {
            result.error = {
                name: result.error.name,
                message: result.error.message,
                stack: result.error.stack,
                ...result.error,
            };
        }
        process.send(result);
        // start creating the next sandbox *after* posting the completion message. This operation
        // happens with coordination from the calling process, but that's OK because we wait for
        // it's initialization.
        setImmediate(() => {
            this.create();
        });
    }
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
    worker.queue.push(message);
});
//# sourceMappingURL=worker.js.map