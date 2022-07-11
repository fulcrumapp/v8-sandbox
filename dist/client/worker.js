"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
exports.__esModule = true;
var fs_1 = __importDefault(require("fs"));
var path_1 = __importDefault(require("path"));
var NativeSandbox = require('bindings')('sandbox').Sandbox;
var RUNTIME = fs_1["default"].readFileSync(path_1["default"].join(__dirname, 'runtime.js')).toString();
var wrapCode = function (code) { return "\n    global._code = ".concat(JSON.stringify(code), ";\n    global._execute();\n  "); };
var Worker = /** @class */ (function () {
    function Worker() {
        var _this = this;
        this.connected = false;
        this.handleMessage = function (message) {
            switch (message.type) {
                case 'initialize':
                    return _this.initialize(message);
                case 'execute':
                    return _this.execute(message);
                case 'callback':
                    return _this.callback(message);
                case 'exit':
                    return _this.exit(message);
                default:
                    throw new Error('invalid message');
            }
        };
        this.native = new NativeSandbox(process.argv[2]);
    }
    Worker.prototype.initialize = function (_a) {
        var template = _a.template;
        this.reset(true);
        this.connect();
        var code = [
            RUNTIME,
            wrapCode(template),
            'setResult()',
        ].join('\n');
        this._execute(code);
    };
    Worker.prototype.execute = function (_a) {
        var code = _a.code, globals = _a.globals;
        this.reset(false);
        this.connect();
        var withGlobals = [
            "Object.assign(global, ".concat(globals, ");"),
            code,
        ].join('\n');
        this._execute(wrapCode(withGlobals));
    };
    Worker.prototype._execute = function (code) {
        return this.native.execute(code);
    };
    Worker.prototype.reset = function (force) {
        if (force || !this.native.initialized) {
            this.native.initialize();
            this.native.initialized = true;
        }
    };
    Worker.prototype.connect = function () {
        if (this.connected) {
            return;
        }
        this.native.connect();
        this.connected = true;
    };
    Worker.prototype.disconnect = function () {
        if (!this.connected) {
            return;
        }
        this.native.disconnect();
        this.connected = false;
    };
    Worker.prototype.callback = function (_a) {
        var id = _a.id, args = _a.args;
        this.native.callback(id, JSON.stringify(args));
    };
    Worker.prototype.exit = function (message) {
        this.disconnect();
        process.off('message', this.handleMessage);
    };
    return Worker;
}());
exports["default"] = Worker;
var worker = new Worker();
process.on('message', worker.handleMessage);
//# sourceMappingURL=worker.js.map