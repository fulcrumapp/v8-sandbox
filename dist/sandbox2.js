"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _fs = _interopRequireDefault(require("fs"));

var _path = _interopRequireDefault(require("path"));

var _request = _interopRequireDefault(require("request"));

var _util = _interopRequireDefault(require("util"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

const NativeSandbox = require('bindings')('sandbox').Sandbox;

const RUNTIME = _fs.default.readFileSync(_path.default.join(__dirname, 'runtime.js')).toString(); // const LINECOUNT = RUNTIME.split('\n').length;


class Sandbox {
  constructor() {
    this.native = new NativeSandbox();
  }

  execute(code, callback) {
    code = [RUNTIME, code].join('\n');
    this.native.execute(code, res => {
      callback(res);
    });
  }

}

exports.default = Sandbox;
//# sourceMappingURL=sandbox2.js.map