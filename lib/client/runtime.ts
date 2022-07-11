const environment: any = global;

environment._try = (func) => {
  try {
    func();
  } catch (ex: any) {
    environment.setResult({
      error: {
        name: ex.name,
        message: ex.message,
        stack: ex.stack,
      },
    });
  }
};

environment._execute = () => {
  environment._try(() => {
    environment._result = null;
    environment._result = eval(environment._code); // eslint-disable-line no-eval
  });
};

environment.dispatch = (name, args, callback) => {
  if (typeof callback !== 'function') {
    callback = null;
  }

  const parameters = [name, JSON.stringify({ name, args: args || [] })];

  const wrappedCallback = callback && ((...args) => {
    environment._try(() => {
      if (callback) {
        callback.apply(null, JSON.parse(args));
      }
    });
  });

  parameters.push(wrappedCallback);

  const json = environment._dispatch.apply(global, parameters);

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
  global[name] = (...args) => environment.dispatch(name, args);
};

environment.defineAsync = (name) => {
  global[name] = (...args) => {
    const callback = args.pop();

    return environment.dispatch(name, args, callback);
  };
};
