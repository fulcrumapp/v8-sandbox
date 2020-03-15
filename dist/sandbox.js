"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _path = _interopRequireDefault(require("path"));

var _child_process = require("child_process");

var _net = _interopRequireDefault(require("net"));

var _uuid = require("uuid");

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

class Socket {
  constructor(socket, sandbox) {
    _defineProperty(this, "handleClose", () => {
      console.log('socket closed');
    });

    _defineProperty(this, "handleData", data => {
      console.log('socket data', data.toString());
      const message = JSON.parse(data);

      const callback = (...args) => {
        this.sandbox.worker.send({
          type: 'callback',
          id: message.id,
          args
        });
      };

      const respond = result => {
        const json = JSON.stringify({
          id: message.id,
          result
        });
        const length = Buffer.byteLength(json, 'utf8');
        const buffer = Buffer.alloc(length + 4);
        buffer.writeInt32LE(length);
        buffer.write(json, 4);
        this.socket.write(buffer);
      };

      this.sandbox.dispatch(message, respond, callback);
    });

    _defineProperty(this, "handleError", error => {
      console.log('socket error', error);
    });

    _defineProperty(this, "handleTimeout", () => {
      console.log('socket timeout');
    });

    _defineProperty(this, "handleDrain", () => {
      console.log('socket drain');
      this.socket.resume();
    });

    _defineProperty(this, "handleEnd", () => {
      console.log('socket end');
    });

    this.sandbox = sandbox;
    this.socket = socket;
    this.socket.on('close', this.handleClose);
    this.socket.on('data', this.handleData);
    this.socket.on('error', this.handleError);
    this.socket.on('drain', this.handleDrain);
    this.socket.on('timeout', this.handleTimeout);
    this.socket.on('end', this.handleEnd);
  }

}

class Sandbox {
  constructor() {
    _defineProperty(this, "handleClose", () => {
      console.log('server closed');
    });

    _defineProperty(this, "handleConnection", socket => {
      console.log('server connection');
      this.socket = new Socket(socket, this);
    });

    _defineProperty(this, "handleError", error => {
      console.log('server error', error);
    });

    _defineProperty(this, "handleListening", () => {
      console.log('server listening', this.socketName);
    });

    this.id = (0, _uuid.v4)();
    this.server = _net.default.createServer();
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

    this.worker = (0, _child_process.fork)(_path.default.join(__dirname, 'worker'), [this.socketName]);
  }

  get socketName() {
    return process.platform === 'win32' ? _path.default.join('\\\\?\\pipe', process.cwd(), this.id) : `/tmp/${this.id}`;
  }

  execute({
    code,
    context,
    timeout
  }, callback) {
    const wrappedCallback = (...args) => {
      if (callback == null || callback.called) {
        return;
      }

      callback.called = true;
      callback(...args);
    };

    this.queue.push({
      code,
      context,
      timeout,
      callback: wrappedCallback
    });
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
    const {
      worker,
      item
    } = this;
    worker.removeAllListeners();
    worker.on('error', error => {
      console.error('worker:error', error);
      this.forkWorker();
      item.callback({
        error: new Error('worker error')
      });
      this.finishItem();
    });
    this.worker.on('exit', () => {
      console.error('worker:exit', worker.exitCode);
    }); // if (timeout > 0) {
    //   worker.executionTimeout = setTimeout(() => {
    //     this.removeWorker(worker);
    //     worker.kill();
    //     callback({error: new TimeoutError('timeout')});
    //   }, timeout);
    // }

    this.worker.send({
      type: 'execute',
      code: item.code,
      context: JSON.stringify(item.context || {})
    });
  }

  shutdown() {
    this.worker.send({
      type: 'exit'
    });
    this.server.close(() => {
      console.log('server shutdown');
    });
  }

  dispatch({
    name,
    args
  }, respond, callback) {
    if (name === 'setResult') {
      respond({
        value: this.setResult(...args)
      });
    }

    if (name === 'test') {
      respond({
        value: args
      });
    } else if (name === 'testAsync') {
      const timerID = setTimeout(() => {
        callback(null, 7171717);
      });
      respond({
        value: +timerID
      });
    }
  }

  setResult(result) {
    // this.worker.send({ type: 'exit' });
    this.item.callback(result);
    this.finishItem();
  }

}

exports.default = Sandbox;
//# sourceMappingURL=sandbox.js.map