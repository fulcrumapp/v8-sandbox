"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
exports.__esModule = true;
var child_process_1 = require("child_process");
var path_1 = __importDefault(require("path"));
var async_1 = __importDefault(require("async"));
var os_1 = __importDefault(require("os"));
var signal_exit_1 = __importDefault(require("signal-exit"));
var lodash_1 = require("lodash");
var sandbox_1 = require("../server/sandbox");
function remove(array, object) {
    var index = array.indexOf(object);
    if (index > -1) {
        array.splice(index, 1);
    }
}
var Cluster = /** @class */ (function () {
    function Cluster(_a) {
        if (_a === void 0) { _a = {}; }
        var _this = this;
        var workers = _a.workers, options = __rest(_a, ["workers"]);
        this.inactiveWorkers = [];
        this.activeWorkers = [];
        this.worker = function (task, callback) {
            _this._execute(task, callback);
        };
        this.workerCount = workers || Math.max(os_1["default"].cpus().length, 4);
        this.sandboxOptions = options;
        this.start();
    }
    Cluster.prototype.start = function () {
        var _this = this;
        this.inactiveWorkers = [];
        this.activeWorkers = [];
        this.queue = async_1["default"].queue(this.worker, this.workerCount);
        this.ensureWorkers();
        (0, signal_exit_1["default"])(function (code, signal) {
            _this.shutdown();
        });
    };
    Cluster.prototype.shutdown = function () {
        for (var _i = 0, _a = this.inactiveWorkers; _i < _a.length; _i++) {
            var worker = _a[_i];
            this.clearWorkerTimeout(worker);
            worker.removeAllListeners();
            worker.kill();
        }
        for (var _b = 0, _c = this.activeWorkers; _b < _c.length; _b++) {
            var worker = _c[_b];
            this.clearWorkerTimeout(worker);
            worker.removeAllListeners();
            worker.kill();
        }
        this.inactiveWorkers = [];
        this.activeWorkers = [];
        if (this.queue) {
            this.queue.kill();
        }
        this.queue = async_1["default"].queue(this.worker, this.workerCount);
    };
    Cluster.prototype.ensureWorkers = function () {
        var total = this.inactiveWorkers.length + this.activeWorkers.length;
        for (var i = 0; i < this.workerCount - total; ++i) {
            var worker = this.forkWorker();
            worker.send(__assign({ initialize: true }, this.sandboxOptions));
            this.inactiveWorkers.push(worker);
        }
    };
    Cluster.prototype.forkWorker = function () {
        return (0, child_process_1.fork)(path_1["default"].join(__dirname, 'worker'), [], { gid: this.sandboxOptions.gid, uid: this.sandboxOptions.uid });
    };
    Cluster.prototype.popWorker = function (callback) {
        var _this = this;
        this.ensureWorkers();
        if (this.inactiveWorkers.length === 0) {
            setImmediate(function () {
                _this.popWorker(callback);
            });
            return;
        }
        var worker = this.inactiveWorkers.shift();
        this.activeWorkers.push(worker);
        if (this.activeWorkers.length + this.inactiveWorkers.length !== this.workerCount) {
            throw new Error('invalid worker count');
        }
        callback(worker);
    };
    Cluster.prototype.clearWorkerTimeout = function (worker) {
        clearTimeout(worker.executionTimeout);
        worker.executionTimeout = null;
    };
    Cluster.prototype.finishWorker = function (worker) {
        this.clearWorkerTimeout(worker);
        remove(this.activeWorkers, worker);
        this.inactiveWorkers.push(worker);
    };
    Cluster.prototype.removeWorker = function (worker) {
        this.clearWorkerTimeout(worker);
        worker.kill();
        worker.removeAllListeners();
        remove(this.activeWorkers, worker);
        remove(this.inactiveWorkers, worker);
        this.ensureWorkers();
    };
    Cluster.prototype.execute = function (_a) {
        var _this = this;
        var code = _a.code, timeout = _a.timeout, globals = _a.globals, context = _a.context;
        return new Promise(function (resolve, reject) {
            var item = {
                code: code,
                timeout: timeout,
                globals: globals || {},
                context: context || {}
            };
            _this.queue.push(item, resolve);
        });
    };
    Cluster.prototype._execute = function (_a, callback) {
        var _this = this;
        var code = _a.code, timeout = _a.timeout, globals = _a.globals, context = _a.context;
        callback = (0, lodash_1.once)(callback);
        this.popWorker(function (worker) {
            worker.removeAllListeners();
            worker.on('message', function (message) {
                _this.finishWorker(worker);
                callback(message);
            });
            worker.on('error', function (message) {
                _this.removeWorker(worker);
                callback({ error: new Error('worker error') });
            });
            worker.on('disconnect', function () {
                _this.removeWorker(worker);
                callback({ error: new Error('worker disconnected') });
            });
            worker.on('exit', function (message) {
                _this.removeWorker(worker);
            });
            if (timeout > 0) {
                worker.executionTimeout = setTimeout(function () {
                    _this.removeWorker(worker);
                    callback({ error: new sandbox_1.TimeoutError(timeout) });
                }, timeout);
            }
            worker.send({
                code: code,
                globals: JSON.stringify(globals),
                context: JSON.stringify(context)
            });
        });
    };
    return Cluster;
}());
exports["default"] = Cluster;
//# sourceMappingURL=cluster.js.map