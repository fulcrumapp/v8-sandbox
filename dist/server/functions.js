"use strict";
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
exports.__esModule = true;
var request_1 = __importDefault(require("request"));
var util_1 = __importDefault(require("util"));
var timer_1 = __importDefault(require("./timer"));
var SYNC_FUNCTIONS = {};
var ASYNC_FUNCTIONS = {};
var Functions = /** @class */ (function () {
    function Functions(sandbox, _a) {
        var require = _a.require, httpEnabled = _a.httpEnabled, timersEnabled = _a.timersEnabled;
        var _this = this;
        this.define = function (name, fn) {
            _this.syncFunctions[name] = fn;
        };
        this.defineAsync = function (name, fn) {
            _this.asyncFunctions[name] = fn;
        };
        this.sandbox = sandbox;
        this.require = require;
        this.httpEnabled = httpEnabled !== null && httpEnabled !== void 0 ? httpEnabled : true;
        this.timersEnabled = timersEnabled !== null && timersEnabled !== void 0 ? timersEnabled : true;
        this.timers = {};
        this.setup();
    }
    Functions.prototype.setup = function () {
        global.define = this.define;
        global.defineAsync = this.defineAsync;
        this.syncFunctions = {};
        this.asyncFunctions = {};
        if (this.require) {
            this.syncFunctions = SYNC_FUNCTIONS[this.require] = SYNC_FUNCTIONS[this.require] || {};
            this.asyncFunctions = ASYNC_FUNCTIONS[this.require] = ASYNC_FUNCTIONS[this.require] || {};
            // eslint-disable-next-line global-require
            require(this.require);
        }
    };
    Functions.prototype.defines = function () {
        return __spreadArray(__spreadArray([], Object.entries(this.syncFunctions).map(function (_a) {
            var name = _a[0];
            return "define('".concat(name, "');\n");
        }), true), Object.entries(this.asyncFunctions).map(function (_a) {
            var name = _a[0];
            return "defineAsync('".concat(name, "');\n");
        }), true);
    };
    Functions.prototype.clearTimers = function () {
        for (var _i = 0, _a = Object.entries(this.timers); _i < _a.length; _i++) {
            var _b = _a[_i], id = _b[0], timer = _b[1];
            timer.clear();
            delete this.timers[id];
        }
    };
    Functions.prototype.dispatch = function (_a, _b) {
        var name = _a.name, args = _a.args;
        var message = _b.message, fail = _b.fail, respond = _b.respond, callback = _b.callback;
        var params = [args, {
                message: message,
                respond: respond,
                fail: fail,
                callback: callback,
                context: message.context
            }];
        switch (name) {
            case 'setResult': {
                return this.setResult.apply(this, params);
            }
            case 'httpRequest': {
                return this.httpRequest.apply(this, params);
            }
            case 'setTimeout': {
                return this.setTimeout.apply(this, params);
            }
            case 'clearTimeout': {
                return this.clearTimeout.apply(this, params);
            }
            case 'log': {
                return this.log.apply(this, params);
            }
            case 'error': {
                return this.error.apply(this, params);
            }
            case 'info': {
                return this.info.apply(this, params);
            }
            default: {
                var fn = this.syncFunctions[name] || this.asyncFunctions[name];
                if (fn) {
                    fn.apply(void 0, params);
                }
                else {
                    throw new Error("".concat(name, " is not a valid method"));
                }
            }
        }
    };
    Functions.prototype.setResult = function (_a, _b) {
        var result = _a[0];
        var message = _b.message, respond = _b.respond;
        this.sandbox.finish(result);
        respond();
    };
    Functions.prototype.setTimeout = function (_a, _b) {
        var timeout = _a[0];
        var fail = _b.fail, respond = _b.respond, callback = _b.callback;
        if (!this.timersEnabled) {
            return fail(new Error('setTimeout is disabled'));
        }
        var timer = new timer_1["default"]();
        timer.start(timeout || 0, callback);
        var id = timer.id;
        this.timers[id] = timer;
        respond(id);
    };
    Functions.prototype.clearTimeout = function (_a, _b) {
        var timerID = _a[0];
        var fail = _b.fail, respond = _b.respond;
        if (!this.timersEnabled) {
            return fail(new Error('clearTimeout is disabled'));
        }
        var timer = this.timers[+timerID];
        if (timer) {
            timer.clear();
            delete this.timers[+timerID];
        }
        respond();
    };
    Functions.prototype.httpRequest = function (_a, _b) {
        var options = _a[0];
        var respond = _b.respond, fail = _b.fail, callback = _b.callback;
        if (!this.httpEnabled) {
            return fail(new Error('httpRequest is disabled'));
        }
        options = options || {};
        (0, request_1["default"])(this.processRequestOptions(options), function (err, response, body) {
            if (response && Buffer.isBuffer(response.body)) {
                response.body = body = response.body.toString('base64');
            }
            if (!callback) {
                if (err) {
                    fail(err);
                }
                else {
                    respond(response);
                }
            }
            else {
                callback(err, response, body);
            }
        });
        if (callback) {
            respond();
        }
    };
    Functions.prototype.log = function (_a, _b) {
        var args = _a[0];
        var message = _b.message, respond = _b.respond, callback = _b.callback;
        this.write({ message: message, type: 'log', args: args });
        console.log.apply(console, args);
        respond();
    };
    Functions.prototype.error = function (_a, _b) {
        var args = _a[0];
        var message = _b.message, respond = _b.respond, callback = _b.callback;
        this.write({ message: message, type: 'error', args: args });
        console.error.apply(console, args);
        respond();
    };
    Functions.prototype.write = function (_a) {
        var message = _a.message, type = _a.type, args = _a.args;
        message.output.push({ type: type, time: new Date(), message: util_1["default"].format.apply(util_1["default"], args) });
    };
    Functions.prototype.info = function (args, _a) {
        var message = _a.message, fail = _a.fail, respond = _a.respond;
        if (!this.sandbox.debug) {
            return fail(new Error('info is disabled'));
        }
        respond({
            versions: process.versions,
            argv: this.sandbox.argv
        });
    };
    Functions.prototype.processRequestOptions = function (options) {
        return options;
    };
    return Functions;
}());
exports["default"] = Functions;
//# sourceMappingURL=functions.js.map