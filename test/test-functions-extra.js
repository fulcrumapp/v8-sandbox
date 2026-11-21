// Additional generic host function fixtures for edge-case tests

define('echoValue', ([value], { respond }) => {
  respond(value);
});

define('echoArgs', (args, { respond }) => {
  respond(args);
});

define('failWithObject', ([payload], { fail }) => {
  fail(payload);
});

define('echoContextDelayed', ([delayMs], { context, respond }) => {
  setTimeout(() => {
    respond(context);
  }, delayMs || 1);
});

defineAsync('asyncEchoContext', ([delayMs, label], { context, respond, callback }) => {
  respond();
  setTimeout(() => {
    callback(null, { label, context });
  }, delayMs || 1);
});

defineAsync('asyncFailObject', ([payload], { respond, callback }) => {
  respond();
  setTimeout(() => {
    callback(payload);
  }, 1);
});

defineAsync('asyncOrSyncSum', (args, { respond, callback }) => {
  const sum = args.reduce((acc, n) => acc + n, 0);
  if (callback) {
    respond();
    setTimeout(() => callback(null, sum), 1);
  } else {
    respond(sum);
  }
});

global.handleHttpRequest = ({ options, rawOptions, context }) => {
  if (context && context.injectHeader) {
    return {
      ...options,
      headers: {
        ...(options.headers || {}),
        'x-injected-context': context.injectHeader,
      },
    };
  }
  return options;
};

global.handleHttpResponse = ({ response, context }) => {
  if (context && context.tagResponse) {
    return {
      ...response,
      headers: {
        ...response.headers,
        'x-tagged-by-hook': context.tagResponse,
      },
    };
  }
  return response;
};

global.handleHttpError = ({ error, context }) => {
  if (context && context.tagError) {
    return {
      ...error,
      code: context.tagError,
    };
  }
  return error;
};
