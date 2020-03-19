"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

function tryParseJSON(value) {
  try {
    return JSON.parse(value);
  } catch (ex) {
    return null;
  }
}

class Socket {
  constructor(socket, sandbox) {
    _defineProperty(this, "handleClose", () => {
      console.log('socket closed');
    });

    _defineProperty(this, "handleData", data => {
      // console.log('socket data1', data);
      const id = data.readInt32BE();
      const json = data.toString('utf8', 4);
      const message = tryParseJSON(json);

      const callback = (...args) => {
        // make sure the current worker is the worker we started with. The worker might've
        // been replaced by the time this is invoked.
        if (this.worker === this.sandbox.worker) {
          this.sandbox.worker.send({
            type: 'callback',
            id,
            args
          });
        }
      };

      const respond = result => {
        const json = JSON.stringify({
          id,
          result
        });
        const length = Buffer.byteLength(json, 'utf8');
        const buffer = Buffer.alloc(length + 4);
        buffer.writeInt32BE(length);
        buffer.write(json, 4); // console.log('writing json', json);

        this.socket.write(buffer);
      };

      try {
        if (message == null) {
          throw new Error('invalid dispatch');
        }

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
    this.worker = sandbox.worker;
    this.socket = socket;
    this.socket.on('close', this.handleClose);
    this.socket.on('data', this.handleData);
    this.socket.on('error', this.handleError);
    this.socket.on('drain', this.handleDrain);
    this.socket.on('timeout', this.handleTimeout);
    this.socket.on('end', this.handleEnd);
  }

  shutdown() {
    if (this.socket) {
      this.socket.end();
      this.socket.unref();
    }
  }

}

exports.default = Socket;
//# sourceMappingURL=socket.js.map