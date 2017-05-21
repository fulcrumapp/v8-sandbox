const char *SandboxRuntime = R"JSRUNTIME(
(function() {

global.httpRequest = (options, callback) => {
  if (typeof callback !== 'function') {
    throw new Error('callback must be a function');
  }

  const wrappedCallback = (args) => {
    callback.apply(null, JSON.parse(args));
  };

  return global._httpRequest(JSON.stringify(options), wrappedCallback);
};

global.setResult = (result) => {
  return global._setResult(JSON.stringify(result));
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
