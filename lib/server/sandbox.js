import path from 'path';
import net from 'net';
import { v4 as uuid } from 'uuid';
import request from 'request';
import wtfnode from 'wtfnode';
import Socket from './socket';
import Host from './host';
import { once } from 'lodash';

class TimeoutError extends Error {
  get isTimeout() {
    return true;
  }
}

export default class Sandbox {
  constructor() {
    this.id = uuid();

    this.server = net.createServer();

    this.server.on('close', this.handleClose);
    this.server.on('connection', this.handleConnection);
    this.server.on('error', this.handleError);
    this.server.on('listening', this.handleListening);

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

  handleClose = () => {
    console.log('server closed');
  }

  handleConnection = (socket) => {
    // console.log('server connection');
    this.socket = new Socket(socket, this);
  }

  handleError = (error) => {
    console.log('server error', error);
  }

  handleListening = () => {
    console.log('server listening', this.socketName);
  }

  execute({ code, context, timeout }, callback) {
    this.queue.push({
      code,
      context: context || {},
      timeout,
      callback: once(callback)
    });

    if (!this.item) {
      this.next();
    }
  }

  next() {
    this.item = null;

    if (this.queue.length === 0) {
      return;
    }

    const item = this.item = this.queue.pop();

    this.host.removeAllListeners();

    this.host.on('error', (error) => {
      console.error('worker:error', error);

      item.callback({ error: new Error('worker error') });

      this.next();
    });

    this.host.on('timeout', () => {
      item.callback({ error: new TimeoutError('timeout') });
  
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

  dispatch({ name, args }, respond, callback) {
    const params = [ ...args, respond, callback ];

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
      default: {
        throw new Error(`${ name } is not a valid method`);
      }
    }
  }

  setResult(result, respond, callback) {
    this.item.callback(result);
    
    respond({ value: null });

    this.next();
  }

  setTimeout(timeout, respond, callback) {
    const timerID = setTimeout(callback, timeout);

    respond({ value: +timerID });
  }

  clearTimeout(timerID, respond, callback) {
    clearTimeout(timerID);

    respond({ value: null });
  }

  httpRequest(options, respond, callback) {
    const { sync } = options;

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
      respond({ value: null });
    }
  }
}