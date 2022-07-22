import axios from 'axios';
import util from 'util';
import Sandbox, { Message, HostError } from './sandbox';
import Timer from './timer';

const SYNC_FUNCTIONS = {};

const ASYNC_FUNCTIONS = {};

interface Timers {
  [key: string]: Timer;
}

interface CustomFunctions {
  [key: string]: Function;
}

export default class Functions {
  sandbox: Sandbox;

  require: string;

  httpEnabled: boolean;

  timersEnabled: boolean;

  timers: Timers;

  syncFunctions: CustomFunctions;

  asyncFunctions: CustomFunctions;

  constructor(sandbox, { require, httpEnabled, timersEnabled }) {
    this.sandbox = sandbox;
    this.require = require;
    this.httpEnabled = httpEnabled ?? true;
    this.timersEnabled = timersEnabled ?? true;
    this.timers = {};

    this.setup();
  }

  setup() {
    global.define = this.define;
    global.defineAsync = this.defineAsync;

    this.syncFunctions = {};
    this.asyncFunctions = {};

    if (this.require) {
      SYNC_FUNCTIONS[this.require] ??= {};
      ASYNC_FUNCTIONS[this.require] ??= {};

      this.syncFunctions = SYNC_FUNCTIONS[this.require];
      this.asyncFunctions = ASYNC_FUNCTIONS[this.require];

      // eslint-disable-next-line global-require
      require(this.require);
    }
  }

  define = (name, fn) => {
    this.syncFunctions[name] = fn;
  };

  defineAsync = (name, fn) => {
    this.asyncFunctions[name] = fn;
  };

  defines() {
    return [
      ...Object.entries(this.syncFunctions).map(([name]) => `define('${name}');\n`),
      ...Object.entries(this.asyncFunctions).map(([name]) => `defineAsync('${name}');\n`),
    ];
  }

  clearTimers() {
    for (const [id, timer] of Object.entries(this.timers)) {
      timer.clear();
      delete this.timers[id];
    }
  }

  dispatch({ name, args }, {
    message, fail, respond, callback, cancel,
  }) {
    const params: [ any, any ] = [args, {
      message, respond, fail, cancel, callback, context: message.context, functions: this,
    }];

    switch (name) {
      case 'finish': {
        this.finish(...params);
        break;
      }
      case 'setResult': {
        this.setResult(...params);
        break;
      }
      case 'httpRequest': {
        (this.asyncFunctions.httpRequest ?? this.httpRequest)(...params);
        break;
      }
      case 'setTimeout': {
        (this.syncFunctions.setTimeout ?? this.setTimeout)(...params);
        break;
      }
      case 'clearTimeout': {
        (this.syncFunctions.clearTimeout ?? this.clearTimeout)(...params);
        break;
      }
      case 'log': {
        (this.syncFunctions.log ?? this.log)(...params);
        break;
      }
      case 'error': {
        (this.syncFunctions.error ?? this.error)(...params);
        break;
      }
      case 'info': {
        (this.syncFunctions.info ?? this.info)(...params);
        break;
      }
      default: {
        const fn = this.syncFunctions[name] ?? this.asyncFunctions[name];

        if (fn) {
          fn(...params);
        } else {
          throw new HostError(`${name} is not a valid method`);
        }
      }
    }
  }

  finish([messageId], { message, respond }) {
    if (this.sandbox.message.id !== messageId) {
      throw new HostError('invalid call to finish');
    }

    this.sandbox.finish(null);

    respond();
  }

  setResult([result], { message, respond }) {
    this.sandbox.setResult(result);

    respond();
  }

  setTimeout = ([timeout], {
    fail, respond, callback, cancel,
  }) => {
    if (!this.timersEnabled) {
      fail(new HostError('setTimeout is disabled'));
      return;
    }

    const timer = new Timer();

    timer.start(timeout || 0, callback, cancel);

    const { id } = timer;

    this.timers[id] = timer;

    respond(id);
  };

  clearTimeout = ([timerId], { fail, respond }) => {
    if (!this.timersEnabled) {
      fail(new HostError('clearTimeout is disabled'));
      return;
    }

    const timer = this.timers[+timerId];

    if (timer) {
      timer.clear();
      delete this.timers[+timerId];
    }

    respond();
  };

  httpRequest = ([options], {
    respond, fail, callback, context,
  }) => {
    if (!this.httpEnabled) {
      fail(new HostError('httpRequest is disabled'));
      return;
    }

    axios(this.processHttpRequest(options ?? {}, context))
      .then((response) => {
        const httpResponse = this.processHttpResponse(response, context);

        if (!callback) {
          respond(httpResponse);
        } else {
          callback(null, httpResponse, httpResponse.body);
        }
      })
      .catch((error) => {
        const httpError = this.processHttpError(error, context);

        if (!callback) {
          fail(httpError);
        } else {
          callback(httpError);
        }
      });

    if (callback) {
      respond();
    }
  };

  log = ([args], {
    message, respond, context,
  }) => {
    this.write({ message, type: 'log', args });
    (global.handleConsoleLog ?? this.handleConsoleLog)({ args, context });
    respond();
  };

  write({ message, type, args }: { message: Message; type: string; args: [ any, any ]}) {
    message.output.push({ type, time: new Date(), message: util.format(...args) });
  }

  error = ([args], {
    message, respond, context,
  }) => {
    this.write({ message, type: 'error', args });
    (global.handleConsoleError ?? this.handleConsoleError)({ args, context });
    respond();
  };

  info = (args, { message, fail, respond }) => {
    if (!this.sandbox.debug) {
      fail(new HostError('info is disabled'));
      return;
    }

    respond({
      versions: process.versions,
      argv: this.sandbox.argv,
    });
  };

  processHttpRequest(rawOptions, context) {
    const options = {
      method: rawOptions.method ?? 'GET',
      url: rawOptions.uri ?? rawOptions.url,
      ...(rawOptions.proxy ? { proxy: rawOptions.proxy } : {}),
      ...(rawOptions.headers ? { headers: rawOptions.headers } : {}),
      ...(rawOptions.params ? { params: rawOptions.params } : {}),
      ...(rawOptions.form ? { data: rawOptions.form } : {}),
      ...(rawOptions.data ? { data: rawOptions.data } : {}),
      ...(rawOptions.auth ? { auth: rawOptions.auth } : {}),
      ...(rawOptions.encoding === null ? { responseType: 'arraybuffer' } : {}),
      ...(rawOptions.responseType ? { responseType: rawOptions.responseType } : {}),
      ...(rawOptions.responseEncoding ? { responseEncoding: rawOptions.responseEncoding } : {}),
      ...(rawOptions.timeout ? { timeout: rawOptions.timeout } : {}),
    };

    return (global.handleHttpRequest ?? this.handleHttpRequest)({ options, rawOptions, context });
  }

  processHttpResponse(rawResponse, context) {
    let { data } = rawResponse;

    if (rawResponse && Buffer.isBuffer(rawResponse.data)) {
      data = rawResponse.data.toString('base64');
    }

    const response = {
      body: data,
      statusCode: rawResponse.status,
      statusText: rawResponse.statusText,
      headers: rawResponse.headers,
    };

    const handleHttpResponse = global.handleHttpResponse ?? this.handleHttpResponse;

    return handleHttpResponse({ response, rawResponse, context });
  }

  processHttpError(rawError, context) {
    const error = {
      message: rawError.message,
      code: rawError.code,
      errno: rawError.errno,
    };

    return (global.handleHttpError ?? this.handleHttpError)({ error, rawError, context });
  }

  handleConsoleLog = ({ args, context }) => console.log(...args);

  handleConsoleError = ({ args, context }) => console.error(...args);

  handleHttpRequest = ({ options, rawOptions, context }) => options;

  handleHttpResponse = ({ response, rawResponse, context }) => response;

  handleHttpError = ({ error, rawError, context }) => error;
}
