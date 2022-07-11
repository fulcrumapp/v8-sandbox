import request from 'request';
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
        return this.httpRequest(...params);
      }
      case 'setTimeout': {
        return this.setTimeout(...params);
      }
      case 'clearTimeout': {
        return this.clearTimeout(...params);
      }
      case 'log': {
        return this.log(...params);
      }
      case 'error': {
        return this.error(...params);
      }
      case 'info': {
        return this.info(...params);
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

  setTimeout([timeout], { fail, respond, callback }) {
    if (!this.timersEnabled) {
      return fail(new Error('setTimeout is disabled'));
    }

    const timer = new Timer();

    timer.start(timeout || 0, callback);

    const { id } = timer;

    this.timers[id] = timer;

    respond(id);
  }

  clearTimeout([timerID], { fail, respond }) {
    if (!this.timersEnabled) {
      return fail(new Error('clearTimeout is disabled'));
    }

    const timer = this.timers[+timerID];

    if (timer) {
      timer.clear();
      delete this.timers[+timerID];
    }

    respond();
  }

  httpRequest([options], { respond, fail, callback }) {
    if (!this.httpEnabled) {
      return fail(new Error('httpRequest is disabled'));
    }

    options = options || {};

    request(this.processRequestOptions(options), (err, response, body) => {
      if (response && Buffer.isBuffer(response.body)) {
        response.body = body = response.body.toString('base64');
      }

      if (!callback) {
        if (err) {
          fail(err);
        } else {
          respond(response);
        }
      } else {
        callback(err, response, body);
      }
    });

    if (callback) {
      respond();
    }
  }

  log([args], { message, respond, callback }) {
    this.write({ message, type: 'log', args });
    console.log(...args);
    respond();
  }

  error([args], { message, respond, callback }) {
    this.write({ message, type: 'error', args });
    console.error(...args);
    respond();
  }

  write({ message, type, args }: { message: Message; type: string; args: [ any, any ]}) {
    message.output.push({ type, time: new Date(), message: util.format(...args) });
  }

  info(args, { message, fail, respond }) {
    if (!this.sandbox.debug) {
      return fail(new Error('info is disabled'));
    }

    respond({
      versions: process.versions,
      argv: this.sandbox.argv,
    });
  }

  processRequestOptions(options) {
    return options;
  }
}
