import path from 'path';
import { fork } from 'child_process';
import net from 'net';
import { v4 as uuid } from 'uuid';
import request from 'request';

class TimeoutError extends Error {
  get isTimeout() {
    return true;
  }
}

class Socket {
  constructor(socket, sandbox) {
    this.sandbox = sandbox;
    this.socket = socket;
    this.socket.on('close', this.handleClose);
    this.socket.on('data', this.handleData);
    this.socket.on('error', this.handleError);
    this.socket.on('drain', this.handleDrain);
    this.socket.on('timeout', this.handleTimeout);
    this.socket.on('end', this.handleEnd);
  }

  handleClose = () => {
    console.log('socket closed');
  }

  handleData = (data) => {
    // console.log('socket data', data.toString());

    const message = JSON.parse(data);

    const callback = (...args) => {
      this.sandbox.worker.send({ type: 'callback', id: message.id, args });
    };

    const respond = (result) => {
      const json = JSON.stringify({ id: message.id, result });
      const length = Buffer.byteLength(json, 'utf8');
      const buffer = Buffer.alloc(length + 4);
  
      buffer.writeInt32LE(length);
      buffer.write(json, 4);
  
      // console.log('writing json', json);
      this.socket.write(buffer);
    }

    try {
      this.sandbox.dispatch(message, respond, callback);
    } catch (ex) {
      return respond({
        error: {
          name: ex.name,
          message: ex.message,
          stack: ex.stack
        }
      });
    }
  }

  handleError = (error) => {
    console.log('socket error', error);
  }

  handleTimeout = () => {
    console.log('socket timeout');
  }

  handleDrain = () => {
    console.log('socket drain');
    this.socket.resume();
  }

  handleEnd = () => {
    console.log('socket end');
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

    this.forkWorker();

    this.queue = [];
  }

  forkWorker() {
    if (this.worker) {
      this.worker.kill();
      this.worker = null;
    }

    this.worker = fork(path.join(__dirname, 'worker'), [ this.socketName ]);
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

  execute({code, context, timeout}, callback) {
    const wrappedCallback = (...args) => {
      if (callback == null || callback.called) {
        return;
      }

      callback.called = true;

      callback(...args);
    };

    this.queue.push({code, context, timeout, callback: wrappedCallback});

    this.executeNext();
  }

  finishItem() {
    this.item = null;
    this.executeNext();
  }

  executeNext() {
    if (this.item || this.queue.length === 0) {
      return;
    }

    this.item = this.queue.pop();

    const { worker, item } = this;

    worker.removeAllListeners();

    worker.on('error', (error) => {
      console.error('worker:error', error);

      this.forkWorker();

      item.callback({ error: new Error('worker error') });

      this.finishItem();
    });

    this.worker.on('exit', () => {
      // console.error('worker:exit', worker.exitCode);
    });

    if (item.timeout > 0) {
      worker.executionTimeout = setTimeout(() => {
        worker.kill();

        this.forkWorker();

        item.callback({ error: new TimeoutError('timeout') });
  
        this.finishItem();
      }, item.timeout);
    }

    this.worker.send({type: 'execute', code: item.code, context: JSON.stringify(item.context || {})});
  }

  shutdown() {
    this.worker.send({ type: 'exit' });
    this.server.close(() => {
      console.log('server shutdown');
    })
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

    if (name === 'setResult') {
      return respond({ value: this.setResult(...args) });
    } if (name === 'test') {
      return respond({ value: args });
    } else if (name === 'testAsync') {
      const timerID = setTimeout(() => {
        callback(null, 7171717);
      });

      return respond({ value: +timerID });
    } else {
      throw new Error(`${ name } is not a valid method`);
    }
  }

  setResult(result, respond, callback) {
    // this.worker.send({ type: 'exit' });
    this.item.callback(result);
    this.finishItem();
    respond({ value: null });
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