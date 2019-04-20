'use strict';

var _sandbox = require('./sandbox');

var _sandbox2 = _interopRequireDefault(_sandbox);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

global.$exports = {};

process.on('message', message => {
  if (message.require) {
    Object.assign(global.$exports, require(message.require));
    return;
  }

  const sandbox = new _sandbox2.default();

  sandbox.execute(message.code, (err, value) => {
    process.send({ err: err, value: value });
  });
});
//# sourceMappingURL=worker.js.map