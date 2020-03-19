global._try = (func) => {
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

global.debug = (...args) => {
  global._debug(JSON.stringify(args));
}

global.dispatch = (name, args, callback) => {
  if (typeof callback !== 'function') {
    callback = null;
  }

  const parameters = [ JSON.stringify({ name, args: args || [] }) ];

  const wrappedCallback = (...args) => {
    global._try(() => {
      callback.apply(null, JSON.parse(args));
    });
  };

  parameters.push(wrappedCallback);

  const json = global._dispatch.apply(global, parameters);

  const result = json != null ? JSON.parse(json).result : null;

  if (result && result.error) {
    throw new Error(result.error.message);
  }

  return result != null ? result.value : null;
}

global.httpRequest = (options, callback) => {
  return global.dispatch('httpRequest', [ options ], callback);
};

global.httpRequestOld = (options, callback) => {
  const parameters = [ JSON.stringify([ options ]) ];

  if (callback) {
    const wrappedCallback = (args) => {
      global._try(() => {
        callback.apply(null, JSON.parse(args));
      });
    };

    parameters.push(wrappedCallback);
  }

  const result = global._httpRequest.apply(global, parameters);

  if (result == null) {
    return null;
  }

  const [error, response] = JSON.parse(result);

  if (!callback && error) {
    throw new Error(error.message);
  }

  return response;
};

global.setResult = (result) => {
  return dispatch('setResult', result != null ? [ result ] : null);
};

global.setTimeout = (callback, timeout) => {
  return global.dispatch('setTimeout', [ timeout ], callback);
};

global.clearTimeout = (id) => {
  return global.dispatch('clearTimeout', [ id ]);
};

global.console = {
  log: (...args) => {
    return global.dispatch('log', [ args ]);
  },
  error: (...args) => {
    return global.dispatch('error', [ args ]);
  }
};

global.define = (name) => {
  global[name] = (...args) => {
    return global.dispatch(name, args);
  };
};

global.defineBlocking = global.define;

global.defineAsync = (name) => {
  global[name] = (...args) => {
    const callback = args.pop();

    return global.dispatch(name, args, callback);
  };
};
