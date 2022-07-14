"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const child_process_1 = require("child_process");
const path_1 = __importDefault(require("path"));
const async_1 = __importDefault(require("async"));
const os_1 = __importDefault(require("os"));
const signal_exit_1 = __importDefault(require("signal-exit"));
const lodash_1 = require("lodash");
const sandbox_1 = require("../host/sandbox");
function remove(array, object) {
    const index = array.indexOf(object);
    if (index > -1) {
        array.splice(index, 1);
    }
}
class Cluster {
    constructor({ workers, ...options } = {}) {
        this.inactiveWorkers = [];
        this.activeWorkers = [];
        this.worker = (task, callback) => {
            this._execute(task, callback);
        };
        this.workerCount = workers || Math.max(os_1.default.cpus().length, 4);
        this.sandboxOptions = options;
        this.start();
    }
    start() {
        this.inactiveWorkers = [];
        this.activeWorkers = [];
        this.queue = async_1.default.queue(this.worker, this.workerCount);
        this.ensureWorkers();
        (0, signal_exit_1.default)((code, signal) => {
            this.shutdown();
        });
    }
    shutdown() {
        for (const worker of this.inactiveWorkers) {
            this.clearWorkerTimeout(worker);
            worker.removeAllListeners();
            worker.kill();
        }
        for (const worker of this.activeWorkers) {
            this.clearWorkerTimeout(worker);
            worker.removeAllListeners();
            worker.kill();
        }
        this.inactiveWorkers = [];
        this.activeWorkers = [];
        if (this.queue) {
            this.queue.kill();
        }
        this.queue = async_1.default.queue(this.worker, this.workerCount);
    }
    ensureWorkers() {
        const total = this.inactiveWorkers.length + this.activeWorkers.length;
        for (let i = 0; i < this.workerCount - total; ++i) {
            const worker = this.forkWorker();
            worker.send({ initialize: true, ...this.sandboxOptions });
            this.inactiveWorkers.push(worker);
        }
    }
    forkWorker() {
        return (0, child_process_1.fork)(path_1.default.join(__dirname, 'worker'), [], {
            execArgv: [], gid: this.sandboxOptions.gid, uid: this.sandboxOptions.uid,
        });
    }
    popWorker(callback) {
        this.ensureWorkers();
        if (this.inactiveWorkers.length === 0) {
            setImmediate(() => {
                this.popWorker(callback);
            });
            return;
        }
        const worker = this.inactiveWorkers.shift();
        if (worker == null) {
            throw new Error('no inactive worker');
        }
        this.activeWorkers.push(worker);
        if (this.activeWorkers.length + this.inactiveWorkers.length !== this.workerCount) {
            throw new Error('invalid worker count');
        }
        callback(worker);
    }
    clearWorkerTimeout(worker) {
        clearTimeout(worker.executionTimeout);
        worker.executionTimeout = null;
    }
    finishWorker(worker) {
        this.clearWorkerTimeout(worker);
        remove(this.activeWorkers, worker);
        this.inactiveWorkers.push(worker);
    }
    removeWorker(worker) {
        this.clearWorkerTimeout(worker);
        worker.kill();
        worker.removeAllListeners();
        remove(this.activeWorkers, worker);
        remove(this.inactiveWorkers, worker);
        this.ensureWorkers();
    }
    execute({ code, timeout, globals, context, }) {
        return new Promise((resolve, reject) => {
            const item = {
                code,
                timeout,
                globals: globals || {},
                context: context || {},
            };
            if (!this.queue) {
                throw new Error('invalid queue');
            }
            this.queue.push(item, resolve);
        });
    }
    _execute({ code, timeout, globals, context, }, callback) {
        callback = (0, lodash_1.once)(callback);
        this.popWorker((worker) => {
            worker.removeAllListeners();
            worker.on('message', (message) => {
                this.finishWorker(worker);
                callback(message);
            });
            worker.on('error', (message) => {
                this.removeWorker(worker);
                callback({ error: new Error('worker error') });
            });
            worker.on('disconnect', () => {
                this.removeWorker(worker);
                callback({ error: new Error('worker disconnected') });
            });
            worker.on('exit', (message) => {
                this.removeWorker(worker);
            });
            if (timeout > 0) {
                worker.executionTimeout = setTimeout(() => {
                    this.removeWorker(worker);
                    callback({ error: new sandbox_1.TimeoutError(timeout) });
                }, timeout);
            }
            worker.send({
                code,
                globals: JSON.stringify(globals),
                context: JSON.stringify(context),
            });
        });
    }
}
exports.default = Cluster;
//# sourceMappingURL=cluster.js.map