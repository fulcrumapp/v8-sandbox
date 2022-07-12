import axios from 'axios';
import util from 'util';
import Sandbox, { Message } from './sandbox';
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
      this.syncFunctions = SYNC_FUNCTIONS[this.require] = SYNC_FUNCTIONS[this.require] || {};
      this.asyncFunctions = ASYNC_FUNCTIONS[this.require] = ASYNC_FUNCTIONS[this.require] || {};

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
    message, fail, respond, callback,
  }) {
    const params: [ any, any ] = [args, {
      message, respond, fail, callback, context: message.context,
    }];

    switch (name) {
      case 'setResult': {
        return this.setResult(...params);
      }
      case 'httpRequest': {
        return (this.asyncFunctions.httpRequest ?? this.httpRequest)(...params);
      }
      case 'setTimeout': {
        return (this.syncFunctions.setTimeout ?? this.setTimeout)(...params);
      }
      case 'clearTimeout': {
        return (this.syncFunctions.clearTimeout ?? this.clearTimeout)(...params);
      }
      case 'log': {
        return (this.syncFunctions.log ?? this.log)(...params);
      }
      case 'error': {
        return (this.syncFunctions.error ?? this.error)(...params);
      }
      case 'info': {
        return (this.syncFunctions.info ?? this.info)(...params);
      }
      default: {
        const fn = this.syncFunctions[name] || this.asyncFunctions[name];

        if (fn) {
          fn(...params);
        } else {
          throw new Error(`${name} is not a valid method`);
        }
      }
    }
  }

  setResult([result], { message, respond }) {
    this.sandbox.finish(result);

    respond();
  }

  setTimeout = ([timeout], { fail, respond, callback }) => {
    if (!this.timersEnabled) {
      return fail(new Error('setTimeout is disabled'));
    }

    const timer = new Timer();

    timer.start(timeout || 0, callback);

    const { id } = timer;

    this.timers[id] = timer;

    respond(id);
  };

  clearTimeout = ([timerID], { fail, respond }) => {
    if (!this.timersEnabled) {
      return fail(new Error('clearTimeout is disabled'));
    }

    const timer = this.timers[+timerID];

    if (timer) {
      timer.clear();
      delete this.timers[+timerID];
    }

    respond();
  };

  httpRequest = ([options], { respond, fail, callback }) => {
    if (!this.httpEnabled) {
      return fail(new Error('httpRequest is disabled'));
    }

    options = options || {};

    axios(this.processHttpRequest(options))
      .then((response) => {
        const httpResponse = this.processHttpResponse(response);

        if (!callback) {
          respond(httpResponse);
        } else {
          callback(null, httpResponse, httpResponse.body);
        }
      })
      .catch((err) => {
        const httpError = this.processHttpError(err);

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

  log = ([args], { message, respond, callback }) => {
    this.write({ message, type: 'log', args });
    console.log(...args);
    respond();
  };

  write({ message, type, args }: { message: Message; type: string; args: [ any, any ]}) {
    message.output.push({ type, time: new Date(), message: util.format(...args) });
  }

  error = ([args], { message, respond, callback }) => {
    this.write({ message, type: 'error', args });
    console.error(...args);
    respond();
  };

  info = (args, { message, fail, respond }) => {
    if (!this.sandbox.debug) {
      return fail(new Error('info is disabled'));
    }

    respond({
      versions: process.versions,
      argv: this.sandbox.argv,
    });
  };

  processHttpRequest(options) {
    return {
      method: options.method ?? 'GET',
      url: options.uri ?? options.url,
      ...(options.proxy ? options.proxy : {}),
      ...(options.headers ? options.headers : {}),
      ...(options.params ? options.params : {}),
      ...(options.data ? options.data : {}),
      ...(options.auth ? options.auth : {}),
      ...(options.responseType ? options.responseType : {}),
      ...(options.responseEncoding ? options.responseEncoding : {}),
      ...(options.timeout ? options.timeout : {}),
    };
  }

  processHttpResponse(response) {
    if (response && Buffer.isBuffer(response.data)) {
      response.data = response.data.toString('base64');
    }

    return {
      body: response.data,
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    };
  }

  processHttpError(err) {
    return {
      message: err.message,
      code: err.code,
      errno: err.errno,
    };
  }
}
