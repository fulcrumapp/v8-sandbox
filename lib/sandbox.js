const NativeSandbox = require('bindings')('sandbox').Sandbox;

import request from 'request';

let nextObjectID = 0;

export default class Sandbox {
  constructor() {
    this._native = new NativeSandbox();
    this.id = ++nextObjectID;
  }

  terminate(callback) {
    this._native.terminate(callback);
  }

  execute(code, callback) {
    this._native.execute(code, (json) => {
      let result = JSON.parse(json);

      if (result == null) {
        result = { error: new Error('no result') };
      }

      callback(result.error, result.value);
    }, this.dispatch.bind(this));
  }

  // handle function calls from the sandbox
  dispatch(invocation) {
    const finish = (err, ...results) => {
      const serialized = [
        err != null ? {message: err.message} : null
      ];

      if (results && results.length) {
        serialized.push.apply(serialized, results);
      }

      invocation.callback(invocation, JSON.stringify(serialized));
    };

    const parameters = JSON.parse(invocation.args);

    // console.log(invocation.name + '(' + JSON.stringify(parameters) + ')');

    if (invocation.name === 'httpRequest') {
      return this.httpRequest(...parameters, finish);
    } else if (invocation.name === 'log') {
      this.log(...parameters);
      return finish(null);
    } else if (invocation.name === 'error') {
      this.error(...parameters);
      return finish(null);
    }

    return finish(null);
  }

  log(...args) {
    console.log(...args);
  }

  error(...args) {
    console.error(...args);
  }

  httpRequest(options, callback) {
    request(options, callback);
  }
}
