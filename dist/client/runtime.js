const environment = global;
environment.dispatch = (name, args, callback) => {
    if (typeof callback !== 'function') {
        callback = null;
    }
    const parameters = [name, JSON.stringify({ name, args: args || [] })];
    const wrappedCallback = callback && ((jsonArguments) => {
        if (callback) {
            callback(...JSON.parse(jsonArguments));
        }
    });
    parameters.push(wrappedCallback);
    const json = environment._dispatch(...parameters);
    const result = json != null ? JSON.parse(json).result : null;
    if (result && result.error) {
        throw new Error(result.error.message);
    }
    return result != null ? result.value : null;
};
environment.httpRequest = (options, callback) => environment.dispatch('httpRequest', [options], callback);
environment.setResult = (result) => environment.dispatch('setResult', result != null ? [result] : null);
environment.setTimeout = (callback, timeout) => environment.dispatch('setTimeout', [timeout], callback);
environment.clearTimeout = (id) => environment.dispatch('clearTimeout', [id]);
environment.info = (id) => environment.dispatch('info', []);
environment.console = {
    log: (...args) => environment.dispatch('log', [args]),
    error: (...args) => environment.dispatch('error', [args]),
};
environment.define = (name) => {
    environment[name] = (...args) => environment.dispatch(name, args);
};
environment.defineAsync = (name) => {
    environment[name] = (...args) => {
        const callback = args.pop();
        return environment.dispatch(name, args, callback);
    };
};
//# sourceMappingURL=runtime.js.map