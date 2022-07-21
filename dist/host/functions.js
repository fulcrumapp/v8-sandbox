"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const axios_1 = __importDefault(require("axios"));
const util_1 = __importDefault(require("util"));
const timer_1 = __importDefault(require("./timer"));
const SYNC_FUNCTIONS = {};
const ASYNC_FUNCTIONS = {};
class Functions {
    constructor(sandbox, { require, httpEnabled, timersEnabled }) {
        this.define = (name, fn) => {
            this.syncFunctions[name] = fn;
        };
        this.defineAsync = (name, fn) => {
            this.asyncFunctions[name] = fn;
        };
        this.setTimeout = ([timeout], { fail, respond, callback, cancel, }) => {
            if (!this.timersEnabled) {
                return fail(new Error('setTimeout is disabled'));
            }
            const timer = new timer_1.default();
            timer.start(timeout || 0, callback, cancel);
            const { id } = timer;
            this.timers[id] = timer;
            respond(id);
        };
        this.clearTimeout = ([timerID], { fail, respond }) => {
            if (!this.timersEnabled) {
                return fail(new Error('clearTimeout is disabled'));
            }
            const timer = this.timers[+timerID];
            if (timer) {
                timer.clear();
                delete this.timers[+timerID];
            }
            respond();
        };
        this.httpRequest = ([options], { respond, fail, callback, context, }) => {
            if (!this.httpEnabled) {
                return fail(new Error('httpRequest is disabled'));
            }
            options = options || {};
            (0, axios_1.default)(this.processHttpRequest(options, context))
                .then((response) => {
                const httpResponse = this.processHttpResponse(response, context);
                if (!callback) {
                    respond(httpResponse);
                }
                else {
                    callback(null, httpResponse, httpResponse.body);
                }
            })
                .catch((error) => {
                const httpError = this.processHttpError(error, context);
                if (!callback) {
                    fail(httpError);
                }
                else {
                    callback(httpError);
                }
            });
            if (callback) {
                respond();
            }
        };
        this.log = ([args], { message, respond, context, callback, }) => {
            this.write({ message, type: 'log', args });
            (global.handleConsoleLog ?? this.handleConsoleLog)({ args, context });
            respond();
        };
        this.error = ([args], { message, respond, context, callback, }) => {
            this.write({ message, type: 'error', args });
            (global.handleConsoleError ?? this.handleConsoleError)({ args, context });
            respond();
        };
        this.info = (args, { message, fail, respond }) => {
            if (!this.sandbox.debug) {
                return fail(new Error('info is disabled'));
            }
            respond({
                versions: process.versions,
                argv: this.sandbox.argv,
            });
        };
        this.handleConsoleLog = ({ args, context }) => console.log(...args);
        this.handleConsoleError = ({ args, context }) => console.error(...args);
        this.handleHttpRequest = ({ options, rawOptions, context }) => options;
        this.handleHttpResponse = ({ response, rawResponse, context }) => response;
        this.handleHttpError = ({ error, rawError, context }) => error;
        this.sandbox = sandbox;
        this.require = require;
        this.httpEnabled = httpEnabled ?? true;
        this.timersEnabled = timersEnabled ?? true;
        this.timers = {};
        this.setup();
    }
    setup() {
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
    }
    defines() {
        return [
            ...Object.entries(this.syncFunctions).map(([name]) => `define('${name}');\n`),
            ...Object.entries(this.asyncFunctions).map(([name]) => `defineAsync('${name}');\n`),
        ];
    }
    clearTimers() {
        for (const [id, timer] of Object.entries(this.timers)) {
            timer.clear();
            delete this.timers[id];
        }
    }
    dispatch({ name, args }, { message, fail, respond, callback, cancel, }) {
        const params = [args, {
                message, respond, fail, cancel, callback, context: message.context, functions: this,
            }];
        switch (name) {
            case 'finish': {
                return this.finish(...params);
            }
            case 'setResult': {
                return this.setResult(...params);
            }
            case 'httpRequest': {
                return (this.asyncFunctions.httpRequest ?? this.httpRequest)(...params);
            }
            case 'setTimeout': {
                return (this.syncFunctions.setTimeout ?? this.setTimeout)(...params);
            }
            case 'clearTimeout': {
                return (this.syncFunctions.clearTimeout ?? this.clearTimeout)(...params);
            }
            case 'log': {
                return (this.syncFunctions.log ?? this.log)(...params);
            }
            case 'error': {
                return (this.syncFunctions.error ?? this.error)(...params);
            }
            case 'info': {
                return (this.syncFunctions.info ?? this.info)(...params);
            }
            default: {
                const fn = this.syncFunctions[name] || this.asyncFunctions[name];
                if (fn) {
                    fn(...params);
                }
                else {
                    throw new Error(`${name} is not a valid method`);
                }
            }
        }
    }
    finish([], { message, respond }) {
        this.sandbox.finish(null);
        respond();
    }
    setResult([result], { message, respond }) {
        this.sandbox.setResult(result);
        respond();
    }
    write({ message, type, args }) {
        message.output.push({ type, time: new Date(), message: util_1.default.format(...args) });
    }
    processHttpRequest(rawOptions, context) {
        const options = {
            method: rawOptions.method ?? 'GET',
            url: rawOptions.uri ?? rawOptions.url,
            ...(rawOptions.proxy ? { proxy: rawOptions.proxy } : {}),
            ...(rawOptions.headers ? { headers: rawOptions.headers } : {}),
            ...(rawOptions.params ? { params: rawOptions.params } : {}),
            ...(rawOptions.form ? { data: rawOptions.form } : {}),
            ...(rawOptions.data ? { data: rawOptions.data } : {}),
            ...(rawOptions.auth ? { auth: rawOptions.auth } : {}),
            ...(rawOptions.encoding === null ? { responseType: 'arraybuffer' } : {}),
            ...(rawOptions.responseType ? { responseType: rawOptions.responseType } : {}),
            ...(rawOptions.responseEncoding ? { responseEncoding: rawOptions.responseEncoding } : {}),
            ...(rawOptions.timeout ? { timeout: rawOptions.timeout } : {}),
        };
        return (global.handleHttpRequest ?? this.handleHttpRequest)({ options, rawOptions, context });
    }
    processHttpResponse(rawResponse, context) {
        let { data } = rawResponse;
        if (rawResponse && Buffer.isBuffer(rawResponse.data)) {
            data = rawResponse.data.toString('base64');
        }
        const response = {
            body: data,
            statusCode: rawResponse.status,
            statusText: rawResponse.statusText,
            headers: rawResponse.headers,
        };
        return (global.handleHttpResponse ?? this.handleHttpResponse)({ response, rawResponse, context });
    }
    processHttpError(rawError, context) {
        const error = {
            message: rawError.message,
            code: rawError.code,
            errno: rawError.errno,
        };
        return (global.handleHttpError ?? this.handleHttpError)({ error, rawError, context });
    }
}
exports.default = Functions;
//# sourceMappingURL=functions.js.map