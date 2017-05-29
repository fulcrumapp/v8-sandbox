'use strict';

var _sandbox = require('./sandbox');

var _sandbox2 = _interopRequireDefault(_sandbox);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

process.on('message', message => {
  const sandbox = new _sandbox2.default();

  sandbox.execute(message.code, (err, value) => {
    process.send({ err: err, value: value });
    process.disconnect();
  });
});
//# sourceMappingURL=worker.js.map