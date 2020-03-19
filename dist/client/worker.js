"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _fs = _interopRequireDefault(require("fs"));

var _path = _interopRequireDefault(require("path"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

const NativeSandbox = require('bindings')('sandbox').Sandbox;

const RUNTIME = _fs.default.readFileSync(_path.default.join(__dirname, 'runtime.js')).toString(); // const LINECOUNT = RUNTIME.split('\n').length;


const wrapCode = code => {
  return `
    global._code = ${JSON.stringify(code)};
    global._execute();
  `;
};

class Worker {
  constructor() {
    _defineProperty(this, "handleMessage", message => {
      switch (message.type) {
        case 'initialize':
          return this.initialize(message);

        case 'execute':
          return this.execute(message);

        case 'callback':
          return this.callback(message);

        case 'exit':
          return this.exit(message);

        default:
          throw new Error('invalid message');
      }
    });

    this.native = new NativeSandbox(process.argv[2]);
  }

  initialize({
    template
  }) {
    this.reset(true);
    this.connect();
    const code = [RUNTIME, wrapCode(template), 'setResult()'].join('\n');

    this._execute(code);
  }

  execute({
    code
  }) {
    this.reset();
    this.connect();

    this._execute(wrapCode(code));
  }

  _execute(code) {
    return this.native.execute(code, result => {
      process.send({
        type: 'result',
        result
      });
    });
  }

  reset(force) {
    if (force || !this.native.initialized) {
      this.native.initialize();
      this.native.initialized = true;
    }
  }

  connect() {
    if (this.connected) {
      return;
    }

    this.native.connect();
    this.connected = true;
  }

  disconnect() {
    if (!this.connected) {
      return;
    }

    this.native.disconnect();
    this.connected = false;
  }

  callback({
    id,
    args
  }) {
    this.native.callback(id, JSON.stringify(args));
  }

  exit(message) {
    this.disconnect();
    process.off('message', this.handleMessage);
  }

}

exports.default = Worker;
const worker = new Worker();
process.on('message', worker.handleMessage);
//# sourceMappingURL=worker.js.map