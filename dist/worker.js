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


class Worker {
  constructor() {
    _defineProperty(this, "handleMessage", message => {
      if (message.type === 'execute') {
        this.execute(message);
      } else if (message.type === 'callback') {
        this.callback(message.id, JSON.stringify(message.args));
      } else if (message.type === 'exit') {
        process.off('message', worker.handleMessage);
      }
    });

    this.native = new NativeSandbox(process.argv[2]);
  }

  execute(message) {
    console.log('executing', process.argv[2], message);
    const code = [RUNTIME, message.code].join('\n');
    this.native.execute(code, result => {
      process.send({
        type: 'result',
        result
      });
    });
  }

  callback(id, message) {
    this.native.callback(id, message);
  }

}

exports.default = Worker;
const worker = new Worker();
process.on('message', worker.handleMessage);
//# sourceMappingURL=worker.js.map