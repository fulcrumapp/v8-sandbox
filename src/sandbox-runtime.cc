const char *SandboxRuntime = R"JSRUNTIME(
(function() {

global._tryCallback = (func) => {
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

global.httpRequest = (options, callback) => {
  const parameters = [ JSON.stringify([ options ]) ];

  if (callback) {
    const wrappedCallback = (args) => {
      global._tryCallback(() => {
        callback.apply(null, JSON.parse(args));
      });
    };

    parameters.push(wrappedCallback);
  }

  const result = global._httpRequest.apply(global, parameters);

  return result != null ? JSON.parse(result) : null;
};

global.setResult = (result) => {
  return global._setResult(result != null ? JSON.stringify(result) : null);
};

global.setTimeout = (callback, timeout) => {
  const handler = () => {
    global._tryCallback(callback);
  };

  return global._setTimeout(handler, timeout);
};

global.clearTimeout = (id) => {
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
})();
)JSRUNTIME";
