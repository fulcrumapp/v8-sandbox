import path from 'path';
import net from 'net';
import request from 'request';
import Socket from './socket';
import Host from './host';
import { once } from 'lodash';
import { v4 as uuid } from 'uuid';
import util from 'util';

class TimeoutError extends Error {
  get isTimeout() {
    return true;
  }
}

export default class Sandbox {
  constructor() {
    this.id = uuid();

    this.server = net.createServer();

    this.server.on('connection', this.handleConnection);
    this.server.on('error', this.handleError);

    this.server.listen(this.socketName);

    this.queue = [];

    this.setup();
  }

  setup() {
    if (this.host) {
      this.host.kill();
    }

    this.host = new Host(this.socketName);
  }

  get socketName() {
    return process.platform === 'win32' ? path.join('\\\\?\\pipe', process.cwd(), this.id)
                                        : `/tmp/${ this.id }`;
  }

  handleConnection = (socket) => {
    // console.log('server connection');
    this.socket = new Socket(socket, this);
  }

  handleError = (error) => {
    console.error('server error', error);
  }

  execute({ code, context, timeout }) {
    return new Promise(resolve => {
      this.queue.push({
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

    this.host.execute(item);
  }

  shutdown(callback) {
    this.host.kill();

    if (this.socket) {
      this.socket.shutdown();
    }

    this.server.close(callback);
  }

  finish(result) {
    if (this.item) {
      this.item.callback( { ...result, output: this.item.output });
      this.item = null;
    }
  }

  dispatch({ name, args }, respond, callback) {
    const params = [ args, respond, callback ];

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
        throw new Error(`${ name } is not a valid method`);
      }
    }
  }

  setResult([ result ], respond, callback) {
    this.finish(result);
    
    respond();

    this.next();
  }

  setTimeout([ timeout ], respond, callback) {
    const timerID = setTimeout(callback, timeout);

    respond({ value: +timerID });
  }

  clearTimeout(timerID, respond, callback) {
    clearTimeout(timerID);

    respond();
  }

  httpRequest([ options ], respond, callback) {
    const { sync } = options || {};

    request(options, (err, response, body) => {
      if (response && Buffer.isBuffer(response.body)) {
        response.body = body = response.body.toString('base64');
      }

      if (sync) {
        respond({ value: { err, response, body } });
      } else {
        callback(err, response, body);
      }
    });

    if (!sync) {
      respond();
    }
  }

  log([ args ], respond, callback) {
    this.write({ type: 'log', args });
    console.log(...args);
    respond();
  }

  error([ args ], respond, callback) {
    this.write({ type: 'error', args });
    console.error(...args);
    respond();
  }

  write({ type, args }) {
    this.item.output.push({ type, time: new Date(), message: util.format(...args) });
  }
}