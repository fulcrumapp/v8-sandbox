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
        // make sure the current host is the host we started with. The host might've
        // been replaced by the time this is invoked.
        if (this.worker === this.sandbox.host.worker) {
          this.sandbox.host.callback(id, args);
        }
      };

      const respond = result => {
        const json = JSON.stringify({
          id,
          result: result || {
            value: null
          }
        });
        const length = Buffer.byteLength(json, 'utf8');
        const buffer = Buffer.alloc(length + 4);
        buffer.writeInt32BE(length);
        buffer.write(json, 4);
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
      console.error('socket error', error);
    });

    _defineProperty(this, "handleDrain", () => {
      this.socket.resume();
    });

    this.sandbox = sandbox;
    this.worker = sandbox.host.worker;
    this.socket = socket;
    this.socket.on('data', this.handleData);
    this.socket.on('error', this.handleError);
    this.socket.on('drain', this.handleDrain);
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