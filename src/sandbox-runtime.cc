const char *SandboxRuntime = R"JSRUNTIME(
(function() {

global.httpRequest = (options, callback) => {
  const parameters = [ JSON.stringify([ options ]) ];

  if (callback) {
    const wrappedCallback = (args) => {
      callback.apply(null, JSON.parse(args));
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
  return global._setTimeout(callback, timeout);
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
