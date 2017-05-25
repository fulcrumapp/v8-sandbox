const NativeSandbox = require('bindings')('sandbox').Sandbox;

import request from 'request';

let nextObjectID = 0;

export class Sandbox {
  constructor() {
    this._native = new NativeSandbox();
    this.id = ++nextObjectID;
  }

  execute(code, timeout, callback) {
    let executionTimeout = null;

    if (timeout > 0) {
      executionTimeout = setTimeout(() => {
        this._native.terminate(callback);
      }, timeout);
    }

    return this._native.execute(code, (err, res) => {
      if (executionTimeout) {
        clearTimeout(executionTimeout);
      }

      callback(err, JSON.parse(res));
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
      finish(null);
    } else if (invocation.name === 'error') {
      this.error(...parameters);
      finish(null);
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
