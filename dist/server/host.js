"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _path = _interopRequireDefault(require("path"));

var _child_process = require("child_process");

var _events = _interopRequireDefault(require("events"));

var _timer = _interopRequireDefault(require("./timer"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

class Host extends _events.default {
  constructor(socketName) {
    super();

    _defineProperty(this, "socketName", void 0);

    _defineProperty(this, "initializeTimeout", void 0);

    _defineProperty(this, "executeTimeout", void 0);

    _defineProperty(this, "worker", void 0);

    _defineProperty(this, "handleTimeout", () => {
      this.fork();
      this.emit('timeout');
    });

    this.socketName = socketName;
    this.initializeTimeout = new _timer.default();
    this.executeTimeout = new _timer.default();
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
    this.initializeTimeout.clear();
    this.executeTimeout.clear();

    if (this.worker) {
      this.worker.removeAllListeners();
      this.worker.send({
        type: 'exit'
      });
      this.worker.kill();
      this.worker = null;
    }
  }

  process(item) {
    switch (item.type) {
      case 'initialize':
        return this.initialize(item);

      case 'execute':
        return this.execute(item);

      default:
        throw new Error('invalid item');
    }
  }

  initialize({
    template,
    timeout
  }) {
    this.initializeTimeout.start(timeout, this.handleTimeout);
    this.worker.send({
      type: 'initialize',
      template: template || ''
    });
  }

  execute({
    code,
    context,
    timeout
  }) {
    this.executeTimeout.start(timeout, this.handleTimeout);
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