"use strict";

global._try = func => {
  try {
    func();
  } catch (ex) {
    global.setResult({
      error: {
        name: ex.name,
        message: ex.message,
        stack: ex.stack
      }
    });
  }
};

global._execute = () => {
  global._try(() => {
    eval(global._code);
  });
};

global.dispatch = (name, args, callback) => {
  if (typeof callback !== 'function') {
    callback = null;
  }

  const parameters = [JSON.stringify({
    name,
    args: args || []
  })];

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

global.httpRequest = (options, callback) => {
  return dispatch('httpRequest', [options], callback);
};

global.setResult = result => {
  return dispatch('setResult', result != null ? [result] : null);
};

global.setTimeout = (callback, timeout) => {
  return dispatch('setTimeout', [timeout], callback);
};

global.clearTimeout = id => {
  return dispatch('clearTimeout', [id]);
};

global.console = {
  log: (...args) => {
    return dispatch('log', [args]);
  },
  error: (...args) => {
    return dispatch('error', [args]);
  }
};

global.define = name => {
  global[name] = (...args) => {
    return dispatch(name, args);
  };
};

global.defineAsync = name => {
  global[name] = (...args) => {
    const callback = args.pop();
    return dispatch(name, args, callback);
  };
};
//# sourceMappingURL=runtime.js.map