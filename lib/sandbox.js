import path from 'path';
import { fork } from 'child_process';
import net from 'net';
import { v4 as uuid } from 'uuid';

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
    console.log('socket data', data.toString());

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
  
      this.socket.write(buffer);
    }

    this.sandbox.dispatch(message, respond, callback);
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

    this.worker = this.forkWorker();
  }

  forkWorker() {
    return fork(path.join(__dirname, 'worker'), [ this.socketName ]);
  }

  get socketName() {
    return process.platform === 'win32' ? path.join('\\\\?\\pipe', process.cwd(), this.id)
                                        : `/tmp/${ this.id }`;
  }

  handleClose = () => {
    console.log('server closed');
  }

  handleConnection = (socket) => {
    console.log('server connection');
    this.socket = new Socket(socket, this);
  }

  handleError = (error) => {
    console.log('server error', error);
  }

  handleListening = () => {
    console.log('server listening', this.socketName);
  }

  execute({code, context, timeout}, callback) {
    this.worker.removeAllListeners();

    this._callback = callback;

    this.worker.on('message', (message) => {
      // this.finishWorker(worker);

      console.log('worker:onmessage')    
    });

    this.worker.on('error', (message) => {
      // this.removeWorker(worker);

      console.log('worker:error')

      callback({error: new Error('worker error')});
    });

    this.worker.on('disconnect', () => {
      // this.removeWorker(worker);

      console.log('worker:disconnect', this.worker.pid)

      // if (this.worker.exitedAfterDisconnect === true) {
      //   console.log('Oh, it was just voluntary – no need to worry');
      // }

      // callback({error: new Error('worker disconnected')});
    });

    this.worker.on('exit', (message) => {
      console.log('worker:exit', this.worker.exitCode);
      // this.worker.kill();
      // this.removeWorker(worker);
      this.server.close(() => {
        console.log('server closed');
      })
    });

    // if (timeout > 0) {
    //   worker.executionTimeout = setTimeout(() => {
    //     this.removeWorker(worker);
    //     worker.kill();
    //     callback({error: new TimeoutError('timeout')});
    //   }, timeout);
    // }

    this.worker.send({type: 'execute', code, context: JSON.stringify(context || {})});
  }

  dispatch({ name, args }, respond, callback) {
    // console.log('MESSAGE', message);

    if (name === 'setResult') {
      respond({ value: this.setResult(...args) });
    } if (name === 'test') {
      respond({ value: args });
    } else if (name === 'testAsync') {
      const timerID = setTimeout(() => {
        console.log('calling!!!!!!!');
        callback(null, 7171717);
      });

      respond({ value: +timerID });
    }
  }

  setResult(result) {
    console.log('reseres')
    console.log('sendingkill')
    this.worker.send({ type: 'exit' });
    this._callback(result);
   
    console.log('reseresyoyoy')
    // this._callback(result);
  }
}