const NativeSandbox = require('bindings')('sandbox').Sandbox;

let nextObjectID = 0;

export class Sandbox {
  constructor() {
    this._native = new NativeSandbox();
    this.id = ++nextObjectID;
  }

  run(code, callback) {
    return this._native.run(code, (err, res) => {
      callback(err, JSON.parse(res));
    }, this.dispatch.bind(this));
  }

  dispatch(object) {
    const finish = (...args) => {
      object.callback(object, JSON.stringify(args));
    };

    finish(null, null, 'response data');
  }
}
