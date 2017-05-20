const NativeSandbox = require('bindings')('sandbox').Sandbox;

let nextObjectID = 0;

export class Sandbox {
  constructor() {
    this._native = new NativeSandbox();
    this.id = ++nextObjectID;
  }

  run(code, callback) {
    return this._native.run(code, callback);
  }
}
