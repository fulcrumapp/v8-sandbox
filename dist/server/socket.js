"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _events = _interopRequireDefault(require("events"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

function tryParseJSON(value) {
  try {
    return JSON.parse(value);
  } catch (ex) {
    return null;
  }
}

class Socket extends _events.default {
  constructor(socket, sandbox) {
    super();

    _defineProperty(this, "handleData", data => {
      const id = data.readInt32BE();
      const json = data.toString('utf8', 4);
      const message = tryParseJSON(json);

      const callback = (...args) => {
        if (this.isConnected) {
          this.sandbox.host.callback(id, args);
        }
      };

      const write = result => {
        const json = JSON.stringify({
          id,
          result: result || {
            value: undefined
          }
        });
        const length = Buffer.byteLength(json, 'utf8');
        const buffer = Buffer.alloc(length + 4);
        buffer.writeInt32BE(length);
        buffer.write(json, 4);

        if (this.isConnected) {
          this.socket.write(buffer);
        }
      };

      const respond = value => {
        write({
          value
        });
      };

      const fail = error => {
        write({
          error: {
            name: error.name,
            message: error.message,
            stack: error.stack
          }
        });
      };

      try {
        if (message == null) {
          throw new Error('invalid dispatch');
        }

        this.sandbox.dispatch(message, {
          fail,
          respond,
          callback
        });
      } catch (ex) {
        fail(ex);
      }
    });

    _defineProperty(this, "handleError", error => {
      console.error('socket error', error);
    });

    _defineProperty(this, "handleDrain", () => {
      this.socket.resume();
    });

    _defineProperty(this, "handleClose", () => {
      this.closed = true;
    });

    _defineProperty(this, "handleEnd", () => {
      this.closed = true;
    });

    this.sandbox = sandbox;
    this.worker = sandbox.host.worker;
    this.socket = socket;
    this.socket.on('data', this.handleData);
    this.socket.on('end', this.handleEnd);
    this.socket.on('close', this.handleClose);
    this.socket.on('error', this.handleError);
    this.socket.on('drain', this.handleDrain);
  }

  shutdown() {
    if (this.socket) {
      this.closed = true;
      this.socket.end();
      this.socket.unref();
    }
  }

  get isConnected() {
    // make sure the current host is the host we started with. The host might've
    // been replaced by the time this is invoked.
    return !this.closed && this.worker === this.sandbox.host.worker;
  }

}

exports.default = Socket;
//# sourceMappingURL=socket.js.map