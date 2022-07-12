// these functions have access to node and are callable from the sandbox

const fs = require('fs');
const path = require('path');

const LARGE_VALUE = fs.readFileSync(path.join(__dirname, 'test.html')).toString();

// Example of a synchronous function
define('addNumbers', ([ value1, value2 ], { respond }) => {
  respond(value1 + value2);
});

// Example of a blocking function. It's a synchronous function for the sandbox, but asynchronous to the host
define('addNumbersBlocking', ([ value1, value2 ], { respond }) => {
  setTimeout(() => {
    respond(value1 + value2);
  }, 1);
});

// Example of an asynchronous function
defineAsync('addNumbersAsync', ([ value1, value2 ], { respond, callback }) => {
  setTimeout(() => {
    callback(null, value1 + value2);
  }, 20);

  respond();
});

defineAsync('errorAsync', ({ callback }) => {
  throw new Error('hi');
});

// this function is async inside the nodejs process but sync in the sandbox
defineAsync('errorAsyncCallback', ([ param1 ], { fail, callback }) => {
  setTimeout(() => {
    fail(new Error(param1));
  }, 1);
});

// this function is async inside the nodejs process and async in the sandbox
defineAsync('errorAsyncCallbackWithRespond', ([ param1 ], { respond, callback }) => {
  setTimeout(() => {
    callback(new Error(param1));
  }, 1);

  respond();
});

defineAsync('executeWithContext', ([ param1 ], { context, fail, respond }) => {
  setTimeout(() => {
    respond(context.customValue);
  }, 1);
});

defineAsync('fetchLargeValue', (args, { fail, respond }) => {
  setTimeout(() => {
    respond(LARGE_VALUE);
  }, 1);
});

// Example of a blocking function. It's a synchronous function for the sandbox, but asynchronous to the host
define('addNumbersBlocking', ([ value1, value2 ], { respond }) => {
  setTimeout(() => {
    respond(value1 + value2);
  }, 1);
});

global.handleConsoleLog = ({ args, context }) => {
  if (context.logFile) {
    fs.appendFileSync(context.logFile, JSON.stringify({ type: 'log', message: args, context }) + '\n');
  } else {
    console.log(...args);
  }
}

global.handleConsoleError = ({ args, context }) => {
  if (context.logFile) {
    fs.appendFileSync(context.logFile, JSON.stringify({ type: 'error', message: args, context }) + '\n');
  } else {
    console.log(...args);
  }
}

global.handleHttpRequest = ({ options, rawOptions, context }) => {
  if (rawOptions.invalidOption) {
    throw new Error('invalid option');
  }

  return options;
}

global.handleHttpResponse = ({ response, rawResponse, context }) => {
  return response;
}

global.handleHttpError = ({ error, rawError, context }) => {
  return error;
}