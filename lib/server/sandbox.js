import fs from 'fs';
import path from 'path';
import net from 'net';
import util from 'util';
import request from 'request';
import { once } from 'lodash';
import Socket from './socket';
import Host from './host';
import Timer from './timer';

class TimeoutError extends Error {
  get isTimeout() {
    return true;
  }
}

const SYNC_FUNCTIONS = {};

const ASYNC_FUNCTIONS = {};

export default class Sandbox {
  constructor({ template, require } = {}) {
    this.id = `v8-sandbox-socket-${ process.pid }`;
    this.template = template || '';
    this.require = require;

    this.server = net.createServer();

    this.server.on('connection', this.handleConnection);
    this.server.on('error', this.handleError);

    this.cleanupSocket();

    this.server.listen(this.socketName);

    this.queue = [];

    this.timers = {};

    this.setup();
  }

  setup() {
    if (this.host) {
      this.host.kill();
    }

    this.host = new Host(this.socketName);

    global.define = this.define.bind(this);
    global.defineAsync = this.defineAsync.bind(this);

    this.syncFunctions = {};
    this.asyncFunctions = {};

    if (this.require) {
      this.syncFunctions = SYNC_FUNCTIONS[this.require] = SYNC_FUNCTIONS[this.require] || {};
      this.asyncFunctions = ASYNC_FUNCTIONS[this.require] = ASYNC_FUNCTIONS[this.require] || {};

      require(this.require);
    }
  }

  define(name, fn) {
    this.syncFunctions[name] = fn;
  }

  defineAsync(name, fn) {
    this.asyncFunctions[name] = fn;
  }

  defines() {
    return [
      ...Object.entries(this.syncFunctions).map(([ name ]) => `define('${name}');\n`),
      ...Object.entries(this.asyncFunctions).map(([ name ]) => `defineAsync('${name}');\n`)
    ];
  }

  get socketName() {
    return process.platform === 'win32' ? path.join('\\\\?\\pipe', process.cwd(), this.id)
                                        : `/tmp/${ this.id }`;
  }

  handleConnection = (socket) => {
    this.socket = new Socket(socket, this);
  }

  handleError = (error) => {
    console.error('server error', error);
  }

  initialize({ timeout } = {}) {
    if (this.host.worker.initialized) {
      return {};
    }

    return new Promise(resolve => {
      this.queue.push({
        type: 'initialize',
        template: [ this.defines().join('\n'), this.template ].join('\n'),
        output: [],
        timeout,
        callback: once((result) => {
          this.host.worker.initialized = true;

          resolve(result);
        })
      });
  
      if (!this.item) {
        this.next();
      }
    });
  }

  async execute({ code, context, timeout }) {
    const result = await this.initialize({ timeout });

    if (result.error) {
      return result;
    }

    return new Promise(resolve => {
      this.queue.push({
        type: 'execute',
        code,
        context: context || {},
        output: [],
        timeout,
        callback: once(resolve)
      });
  
      if (!this.item) {
        this.next();
      }
    });
  }

  next() {
    this.item = null;

    if (this.queue.length === 0) {
      return;
    }

    const item = this.item = this.queue.pop();

    this.host.removeAllListeners();

    this.host.on('error', (error) => {
      console.error('worker error', error);

      this.finish({ error: new Error('worker error') });

      this.next();
    });

    this.host.on('timeout', () => {
      this.finish({ error: new TimeoutError('timeout') });
  
      this.next();
    });

    this.host.process(item);
  }

  cleanupSocket() {
    try {
      fs.unlinkSync(this.socketName);
    } catch (ex) {
    }
  }

  shutdown(callback) {
    this.clearTimers();

    this.host.kill();

    if (this.socket) {
      this.socket.shutdown();
    }

    this.server.close(() => {
      this.cleanupSocket();

      if (callback) {
        callback();
      }
    });
  }

  finish(result) {
    if (this.item) {
      this.item.callback( { ...result, output: this.item.output });
      this.item = null;
    }

    this.clearTimers();
  }

  clearTimers() {
    for (const [ id, timer ] of Object.entries(this.timers)) {
      timer.clear();
      delete this.timers[id];
    }
  }

  dispatch({ name, args }, { fail, respond, callback }) {
    const params = [ args, { respond, fail, callback } ];

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
      default: {
        const fn = this.syncFunctions[name] || this.asyncFunctions[name];

        if (fn) {
          fn(...params);
        } else {
          throw new Error(`${ name } is not a valid method`);
        }
      }
    }
  }

  setResult([ result ], { respond }) {
    this.finish(result);
    
    respond();

    this.next();
  }

  setTimeout([ timeout ], { respond, callback }) {
    const timer = new Timer();

    timer.start(timeout || 0, callback);

    const id = timer.id;

    this.timers[id] = timer;

    respond(id);
  }

  clearTimeout([ timerID ], { respond }) {
    const timer = this.timers[+timerID];

    if (timer) {
      timer.clear();
      delete this.timers[+timerID];
    }

    respond();
  }

  httpRequest([ options ], { respond, callback }) {
    const { sync } = options || {};

    request(options, (err, response, body) => {
      if (response && Buffer.isBuffer(response.body)) {
        response.body = body = response.body.toString('base64');
      }

      if (sync) {
        respond(err, response, body);
      } else {
        callback(err, response, body);
      }
    });

    if (!sync) {
      respond();
    }
  }

  log([ args ], { respond, callback }) {
    this.write({ type: 'log', args });
    console.log(...args);
    respond();
  }

  error([ args ], { respond, callback }) {
    this.write({ type: 'error', args });
    console.error(...args);
    respond();
  }

  write({ type, args }) {
    this.item.output.push({ type, time: new Date(), message: util.format(...args) });
  }
}