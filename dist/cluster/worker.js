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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (_) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
exports.__esModule = true;
var async_1 = __importDefault(require("async"));
var assert_1 = __importDefault(require("assert"));
var sandbox_1 = __importDefault(require("../server/sandbox"));
var globalSandbox = null;
var Worker = /** @class */ (function () {
    function Worker() {
        var _this = this;
        this.initialized = false;
        this.worker = function (message) { return __awaiter(_this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!message.initialize) return [3 /*break*/, 2];
                        return [4 /*yield*/, this.onInitialize(message)];
                    case 1:
                        _a.sent();
                        return [3 /*break*/, 4];
                    case 2: return [4 /*yield*/, this.onExecute(message)];
                    case 3:
                        _a.sent();
                        _a.label = 4;
                    case 4: return [2 /*return*/];
                }
            });
        }); };
        this.onInitialize = function (message) { return __awaiter(_this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        this.sandboxOptions = message;
                        return [4 /*yield*/, this.create()];
                    case 1:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        }); };
        this.onExecute = function (message) { return __awaiter(_this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.wait()];
                    case 1:
                        _a.sent();
                        return [4 /*yield*/, this.execute(message)];
                    case 2:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        }); };
        this.queue = async_1["default"].queue(this.worker, 1);
    }
    Worker.prototype.create = function () {
        if (!globalSandbox) {
            globalSandbox = new sandbox_1["default"](this.sandboxOptions);
        }
        this.sandbox = globalSandbox;
        this.initialized = false;
        return this.initialize();
    };
    Worker.prototype.initialize = function () {
        return __awaiter(this, void 0, void 0, function () {
            var error, error_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        (0, assert_1["default"])(!this.initialized);
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, , 4]);
                        if (!this.sandbox) {
                            throw new Error('sandbox not available');
                        }
                        return [4 /*yield*/, this.sandbox.initialize()];
                    case 2:
                        error = (_a.sent()).error;
                        if (error) {
                            this.error = error;
                        }
                        return [3 /*break*/, 4];
                    case 3:
                        error_1 = _a.sent();
                        this.error = error_1;
                        return [3 /*break*/, 4];
                    case 4:
                        this.initialized = true;
                        return [2 /*return*/];
                }
            });
        });
    };
    Worker.prototype.wait = function () {
        var _this = this;
        return new Promise(function (resolve, _reject) {
            var check = function () {
                if (_this.initialized) {
                    resolve();
                }
                else {
                    setImmediate(check);
                }
            };
            check();
        });
    };
    Worker.prototype.execute = function (_a) {
        var code = _a.code, timeout = _a.timeout, globals = _a.globals, context = _a.context;
        return __awaiter(this, void 0, void 0, function () {
            var result;
            var _this = this;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        (0, assert_1["default"])(this.initialized);
                        if (!this.sandbox) {
                            throw new Error('sandbox not available');
                        }
                        if (!!this.error) return [3 /*break*/, 2];
                        return [4 /*yield*/, this.sandbox.execute({
                                code: code,
                                timeout: timeout,
                                globals: JSON.parse(globals),
                                context: JSON.parse(context)
                            })];
                    case 1:
                        result = _b.sent();
                        return [3 /*break*/, 3];
                    case 2:
                        result = { error: this.error, output: [] };
                        _b.label = 3;
                    case 3:
                        // convert native error objects into an object that can be serialized
                        if (result.error) {
                            result.error = __assign({ name: result.error.name, message: result.error.message, stack: result.error.stack }, result.error);
                        }
                        if (process.send) {
                            process.send(result);
                        }
                        // start creating the next sandbox *after* posting the completion message.
                        // This operation happens with coordination from the calling process, but
                        // that's OK because we wait for it's initialization.
                        setImmediate(function () {
                            _this.create();
                        });
                        return [2 /*return*/];
                }
            });
        });
    };
    return Worker;
}());
var worker = new Worker();
// heartbeat the parent process to make sure this worker process never gets orphaned
// if the parent process is killed with SIGKILL, the atExit() handler never runs, which
// leaves this process around forever.
setInterval(function () {
    if (!process.connected) {
        process.exit();
    }
}, 5000);
process.on('message', function (message) {
    worker.queue.push(message);
});
//# sourceMappingURL=worker.js.map