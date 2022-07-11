"use strict";
var environment = global;
environment._try = function (func) {
    try {
        func();
    }
    catch (ex) {
        environment.setResult({
            error: {
                name: ex.name,
                message: ex.message,
                stack: ex.stack
            }
        });
    }
};
environment._execute = function () {
    environment._try(function () {
        environment._result = null;
        environment._result = eval(environment._code); // eslint-disable-line no-eval
    });
};
environment.dispatch = function (name, args, callback) {
    if (typeof callback !== 'function') {
        callback = null;
    }
    var parameters = [name, JSON.stringify({ name: name, args: args || [] })];
    var wrappedCallback = callback && (function () {
        var args = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            args[_i] = arguments[_i];
        }
        environment._try(function () {
            if (callback) {
                callback.apply(null, JSON.parse(args));
            }
        });
    });
    parameters.push(wrappedCallback);
    var json = environment._dispatch.apply(global, parameters);
    var result = json != null ? JSON.parse(json).result : null;
    if (result && result.error) {
        throw new Error(result.error.message);
    }
    return result != null ? result.value : null;
};
environment.httpRequest = function (options, callback) { return environment.dispatch('httpRequest', [options], callback); };
environment.setResult = function (result) { return environment.dispatch('setResult', result != null ? [result] : null); };
environment.setTimeout = function (callback, timeout) { return environment.dispatch('setTimeout', [timeout], callback); };
environment.clearTimeout = function (id) { return environment.dispatch('clearTimeout', [id]); };
environment.info = function (id) { return environment.dispatch('info', []); };
environment.console = {
    log: function () {
        var args = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            args[_i] = arguments[_i];
        }
        return environment.dispatch('log', [args]);
    },
    error: function () {
        var args = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            args[_i] = arguments[_i];
        }
        return environment.dispatch('error', [args]);
    }
};
environment.define = function (name) {
    global[name] = function () {
        var args = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            args[_i] = arguments[_i];
        }
        return environment.dispatch(name, args);
    };
};
environment.defineAsync = function (name) {
    global[name] = function () {
        var args = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            args[_i] = arguments[_i];
        }
        var callback = args.pop();
        return environment.dispatch(name, args, callback);
    };
};
//# sourceMappingURL=runtime.js.map