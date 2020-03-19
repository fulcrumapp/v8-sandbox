"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _path = _interopRequireDefault(require("path"));

var _child_process = require("child_process");

var _events = _interopRequireDefault(require("events"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

class Host extends _events.default {
  constructor(socketName) {
    super();
    this.socketName = socketName;
    this.fork();
  }

  fork() {
    this.kill();
    this.worker = (0, _child_process.fork)(_path.default.join(__dirname, '..', 'client', 'worker'), [this.socketName]);
    this.worker.on('error', error => {
      this.fork();
      this.emit('error', error);
    });
    this.worker.on('exit', () => {
      this.emit('exit');
    });
  }

  kill() {
    this.clearTimeout();

    if (this.worker) {
      this.worker.removeAllListeners();
      this.worker.kill();
      this.worker = null;
    }
  }

  clearTimeout() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  execute({
    code,
    context,
    timeout
  }) {
    if (timeout > 0) {
      this.clearTimeout();
      this.timer = setTimeout(() => {
        this.fork();
        this.emit('timeout');
      }, timeout);
    }

    this.worker.send({
      type: 'execute',
      code,
      context: JSON.stringify(context)
    });
  }

  callback(id, args) {
    this.worker.send({
      type: 'callback',
      id,
      args
    });
  }

}

exports.default = Host;
//# sourceMappingURL=host.js.map