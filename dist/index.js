"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
Object.defineProperty(exports, "SandboxCluster", {
  enumerable: true,
  get: function () {
    return _cluster.default;
  }
});
exports.default = void 0;

var _sandbox = _interopRequireDefault(require("./server/sandbox"));

var _cluster = _interopRequireDefault(require("./cluster/cluster"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var _default = _sandbox.default;
exports.default = _default;
//# sourceMappingURL=index.js.map