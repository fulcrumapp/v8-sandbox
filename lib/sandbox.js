const NativeSandbox = require('bindings')('sandbox').Sandbox;

import request from 'request';

let nextObjectID = 0;

function tryParseJSON(value) {
  try {
    return JSON.parse(value);
  } catch (ex) {
    return null;
  }
}

export default class Sandbox {
  constructor() {
    this._native = new NativeSandbox();
    this.id = ++nextObjectID;
  }

  initialize() {
    return new Promise((resolve) => {
      this._native.initialize(() => {
        setImmediate(resolve);
      }, this.dispatch.bind(this));
    });
  }

  async eval(code) {
    await this.initialize();

    const result = await this.execute(code);

    await this.finalize();

    return result;
  }

  execute(code, callback) {
    return new Promise((resolve, reject) => {
      this._native.execute(code, (json) => {
        let result = tryParseJSON(json);

        if (result == null) {
          result = { error: new Error('no result') };
        }

        setImmediate(() => {
          resolve(result);
        });
      }, this.dispatch.bind(this));
    });
  }

  finalize() {
    return new Promise((resolve) => {
      this._native.finalize(() => {
        setImmediate(resolve);
      }, this.dispatch.bind(this));
    });
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

    const parameters = tryParseJSON(invocation.args);

    if (parameters == null) {
      return finish(new Error('invalid invocation parameters'));
    }

    if (invocation.name === 'dispatchSync') {
      return this.dispatchSync(parameters, finish);
    } else if (invocation.name === 'dispatchAsync') {
      return this.dispatchAsync(parameters, finish);
    } else if (invocation.name === 'httpRequest') {
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
    request(options, (err, response, body) => {
      if (response && Buffer.isBuffer(response.body)) {
        response.body = body = response.body.toString('base64');
      }

      callback(err, response, body);
    });
  }

  dispatchSync(args, callback) {
    try {
      const name = args[0];
      const parameters = args.slice(1);

      callback(null, global.$exports[name](...parameters));
    } catch (err) {
      callback(err);
    }
  }

  dispatchAsync(args, callback) {
    try {
      const name = args[0];
      const parameters = args.slice(1);

      global.$exports[name](...[ ...parameters, callback ]);
    } catch (err) {
      callback(err);
    }
  }
}
