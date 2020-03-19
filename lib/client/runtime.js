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

global.dispatchSync = (name, args) => {
  const parameters = [ JSON.stringify({ name, args: args || [] }) ];

  const result = global._dispatchSync.apply(global, parameters);

  if (result == null) {
    return null;
  }

  const { error, value } = JSON.parse(result).result;

  if (error) {
    throw new Error(error.message);
  }

  return value;
}

global.debug = (...args) => {
  global._debug(JSON.stringify(args));
}

global.dispatchAsync = (name, args, callback) => {
  if (typeof callback !== 'function') {
    callback = () => {};
  }

  const parameters = [ JSON.stringify({ name, args: args || [] }) ];

  const wrappedCallback = (...args) => {
    global._try(() => {
      callback.apply(null, JSON.parse(args));
    });
  };

  parameters.push(wrappedCallback);

  const json = global._dispatchAsync.apply(global, parameters);

  const result = json != null ? JSON.parse(json).result : null;

  if (result && result.error) {
    throw new Error(result.error.message);
  }

  return result != null ? result.value : null;
}

global.httpRequest = (options, callback) => {
  return global.dispatchAsync('httpRequest', [ options ], callback);
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
  return dispatchSync('setResult', result != null ?  [ result ] : null);
};

global.setTimeout = (callback, timeout) => {
  return global.dispatchAsync('setTimeout', [ timeout ], callback);
};

global.clearTimeout = (id) => {
  return global.dispatchAsync('clearTimeout', [ id ]);
};

global.console = {
  log: (...args) => {
    return global.dispatchAsync('log', args);
  },
  error: (...args) => {
    return global.dispatchAsync('error', args);
  }
};

global.define = (name) => {
  global[name] = (...args) => {
    return global.dispatchSync(name, args);
  };
};

global.defineBlocking = global.define;

global.defineAsync = (name) => {
  global[name] = (...args) => {
    const callback = args.pop();

    return global.dispatchAsync(name, args, callback);
  };
};
