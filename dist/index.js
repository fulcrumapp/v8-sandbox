'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.Sandbox = undefined;

var _request = require('request');

var _request2 = _interopRequireDefault(_request);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

const NativeSandbox = require('bindings')('sandbox').Sandbox;

let nextObjectID = 0;

class Sandbox {
  constructor() {
    this._native = new NativeSandbox();
    this.id = ++nextObjectID;
  }

  static run(code, callback) {
    new Sandbox().run(code, callback);
  }

  run(code, callback) {
    return this._native.run(code, (err, res) => {
      callback(err, JSON.parse(res));
    }, this.dispatch.bind(this));
  }

  // handle function calls from the sandbox
  dispatch(invocation) {
    const finish = function finish(err) {
      for (var _len = arguments.length, results = Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) {
        results[_key - 1] = arguments[_key];
      }

      const serialized = [err != null ? { message: err.message } : null];

      if (results && results.length) {
        serialized.push.apply(serialized, results);
      }

      invocation.callback(invocation, JSON.stringify(serialized));
    };

    const parameters = JSON.parse(invocation.args);

    // console.log(invocation.name + '(' + JSON.stringify(parameters) + ')');

    if (invocation.name === 'httpRequest') {
      return this.httpRequest(...parameters, finish);
    }

    return finish(null);
  }

  httpRequest(options, callback) {
    (0, _request2.default)(options, callback);
  }
}
exports.Sandbox = Sandbox;
//# sourceMappingURL=index.js.map