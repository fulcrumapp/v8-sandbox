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

  run(code, callback) {
    return this._native.run(code, result => {
      console.log('finished!', result);
      callback(result);
    });
  }
}
exports.Sandbox = Sandbox;
//# sourceMappingURL=index.js.map