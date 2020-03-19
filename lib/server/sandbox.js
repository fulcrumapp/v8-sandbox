import path from 'path';
import { fork } from 'child_process';
import net from 'net';
import { v4 as uuid } from 'uuid';
import request from 'request';
import wtfnode from 'wtfnode';
import Socket from './socket';

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

    this.forkWorker();

    this.queue = [];
  }

  forkWorker() {
    this.clearWorkerTimeout();

    if (this.worker) {
      this.worker = null;
    }

    this.worker = fork(path.join(__dirname, '..', 'client', 'worker'), [ this.socketName ]);
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
      this.clearWorkerTimeout();

      this.executionTimeout = setTimeout(() => {
        worker.kill();

        this.forkWorker();

        item.callback({ error: new TimeoutError('timeout') });
  
        this.finishItem();
      }, item.timeout);
    }

    this.worker.send({type: 'execute', code: item.code, context: JSON.stringify(item.context || {})});
  }

  clearWorkerTimeout() {
    if (this.worker) {
      clearTimeout(this.executionTimeout);
      this.executionTimeout = null;
    }
  }

  shutdown() {
    if (this.socket) {
      this.socket.shutdown();
    }

    this.clearWorkerTimeout();

    this.worker.send({ type: 'exit' });
    this.worker.kill();

    this.server.close(() => {
      console.log('server shutdown');

      wtfnode.dump();
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