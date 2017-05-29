'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.Sandbox = undefined;

var _child_process = require('child_process');

var _path = require('path');

var _path2 = _interopRequireDefault(_path);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

class TimeoutError extends Error {
  get isTimeout() {
    return true;
  }
}

class Sandbox {
  execute(code, timeout, callback) {
    let executionTimeout = null;

    const child = (0, _child_process.fork)(_path2.default.join(__dirname, 'worker'));

    child.on('message', message => {
      callback(message.err, message.value);
    });

    child.on('error', message => {
      clearTimeout(executionTimeout);
    });

    child.on('disconnect', () => {
      clearTimeout(executionTimeout);
    });

    child.on('exit', message => {
      clearTimeout(executionTimeout);
    });

    if (timeout > 0) {
      executionTimeout = setTimeout(() => {
        child.kill();
        callback(new TimeoutError('timeout'));
      }, timeout);
    }

    child.send({ code: code });
  }
}
exports.Sandbox = Sandbox;
//# sourceMappingURL=index.js.map