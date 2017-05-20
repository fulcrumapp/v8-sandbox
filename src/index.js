const NativeSandbox = require('bindings')('sandbox').Sandbox;

let nextObjectID = 0;

export class Sandbox {
  constructor() {
    this._native = new NativeSandbox();
    this.id = ++nextObjectID;
  }

  run(code, timeout) {
    return this._native.run(code);
  }
}
