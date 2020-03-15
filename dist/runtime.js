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

global._callbackID = 0;
global._callbacks = {};

global._callback = message => {
  message = JSON.parse(message);
  const callback = global._callbacks[message.id];

  if (callback) {
    delete global._callbacks[message.id];
    callback.apply(null, message.args);
  }
};

global.dispatchSync = (name, args) => {
  const id = global._callbackID++;
  const parameters = [id, JSON.stringify({
    id,
    name,
    args: args || []
  })];

  const result = global._dispatchSync.apply(global, parameters);

  _debug("REZZZZZ");

  _debug(JSON.stringify(result));

  if (result == null) {
    return null;
  }

  const {
    error,
    value
  } = JSON.parse(result).result;

  if (error) {
    throw new Error(error.message);
  }

  global._debug("Hello3");

  return value;
};

global.dispatchAsync = (name, args, callback) => {
  if (typeof callback !== 'function') {
    callback = () => {};
  }

  const id = global._callbackID++;
  const parameters = [id, JSON.stringify({
    id,
    name,
    async: true,
    args: args || []
  })];

  const wrappedCallback = (...args) => {
    global._try(() => {
      callback.apply(null, JSON.parse(args));
    });
  };

  parameters.push(wrappedCallback);

  _debug("yoyoyoyoyoyoyoy");

  _debug(typeof global._dispatchAsync);

  _debug(JSON.stringify(parameters));

  const result = global._dispatchAsync.apply(global, parameters);

  _debug("afterit");

  return result != null ? JSON.parse(result) : null;
};

global.httpRequest = (options, callback) => {
  const parameters = [JSON.stringify([options])];

  if (callback) {
    const wrappedCallback = args => {
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

global.setResult = result => {
  return dispatchSync('setResult', result != null ? [result] : null); // return global._setResult(result != null ? JSON.stringify(result) : null);
};

global.setTimeout = (callback, timeout) => {
  const handler = () => {
    global._try(callback);
  };

  return global._setTimeout(handler, timeout);
};

global.clearTimeout = id => {
  return global._clearTimeout(id);
};

global.console = {
  log: (...args) => {
    global._log(JSON.stringify(args));
  },
  error: (...args) => {
    global._error(JSON.stringify(args));
  }
};

global.define = name => {
  global[name] = (...args) => {
    return global.dispatchSync(name, args);
  };
};

global.defineBlocking = global.define;

global.defineAsync = name => {
  global[name] = (...args) => {
    const callback = args.pop();
    return global.dispatchAsync(name, args, callback);
  };
};
//# sourceMappingURL=runtime.js.map