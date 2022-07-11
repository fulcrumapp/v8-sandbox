// @ts-nocheck

Error.prepareStackTrace = (err, callsites) => {
  const parts = [];

  callsites.forEach((callsite) => {
    const functionName = callsite.getFunctionName() ?? '<anonymous>';

    parts.push(`at ${functionName} (<script>:${callsite.getLineNumber()}:${callsite.getColumnNumber()})`);
  });

  return parts.join('\n    ');
};

global._try = (func) => {
  try {
    func();
  } catch (ex) {
    global.setResult({
      error: {
        name: ex.name,
        message: ex.message,
        stack: ex.stack,
      },
    });
  }
};

global._execute = () => {
  global._try(() => {
    global._result = null;
    global._result = eval(global._code);
  });
};

global.dispatch = (name, args, callback) => {
  if (typeof callback !== 'function') {
    callback = null;
  }

  const parameters = [name, JSON.stringify({ name, args: args || [] })];

  const wrappedCallback = callback && ((...args) => {
    global._try(() => {
      if (callback) {
        callback.apply(null, JSON.parse(args));
      }
    });
  });

  parameters.push(wrappedCallback);

  const json = global._dispatch.apply(global, parameters);

  const result = json != null ? JSON.parse(json).result : null;

  if (result && result.error) {
    throw new Error(result.error.message);
  }

  return result != null ? result.value : null;
};

global.httpRequest = (options, callback) => dispatch('httpRequest', [options], callback);

global.setResult = (result) => dispatch('setResult', result != null ? [result] : null);

global.setTimeout = (callback, timeout) => dispatch('setTimeout', [timeout], callback);

global.clearTimeout = (id) => dispatch('clearTimeout', [id]);

global.info = (id) => dispatch('info', []);

global.console = {
  log: (...args) => dispatch('log', [args]),
  error: (...args) => dispatch('error', [args]),
};

global.define = (name) => {
  global[name] = (...args) => dispatch(name, args);
};

global.defineAsync = (name) => {
  global[name] = (...args) => {
    const callback = args.pop();

    return dispatch(name, args, callback);
  };
};
