'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
const NativeSandbox = require('bindings')('sandbox').Sandbox;

let nextObjectID = 0;

class Sandbox {
  constructor() {
    this._native = new NativeSandbox();
    this.id = ++nextObjectID;
  }

  run(code, timeout) {
    // run
    return 1;
  }
}
exports.Sandbox = Sandbox;
//# sourceMappingURL=index.js.map