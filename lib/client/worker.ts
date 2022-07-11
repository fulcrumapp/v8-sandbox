import fs from 'fs';
import path from 'path';

const NativeSandbox = require('bindings')('sandbox').Sandbox;

const RUNTIME = fs.readFileSync(path.join(__dirname, 'runtime.js')).toString();

const wrapCode = (code) => `
    global._code = ${JSON.stringify(code)};
    global._execute();
  `;

export default class Worker {
  native: any;

  connected: boolean = false;

  constructor() {
    this.native = new NativeSandbox(process.argv[2]);
  }

  initialize({ template }) {
    this.reset(true);

    this.connect();

    const code = [
      RUNTIME,
      wrapCode(template),
      'setResult()',
    ].join('\n');

    this._execute(code);
  }

  execute({ code, globals }) {
    this.reset(false);

    this.connect();

    const withGlobals = [
      `Object.assign(global, ${globals});`,
      code,
    ].join('\n');

    this._execute(wrapCode(withGlobals));
  }

  _execute(code) {
    return this.native.execute(code);
  }

  reset(force) {
    if (force || !this.native.initialized) {
      this.native.initialize();
      this.native.initialized = true;
    }
  }

  connect() {
    if (this.connected) {
      return;
    }

    this.native.connect();
    this.connected = true;
  }

  disconnect() {
    if (!this.connected) {
      return;
    }

    this.native.disconnect();
    this.connected = false;
  }

  callback({ id, args }) {
    this.native.callback(id, JSON.stringify(args));
  }

  exit(message) {
    this.disconnect();
    process.off('message', this.handleMessage);
  }

  handleMessage = (message) => {
    switch (message.type) {
      case 'initialize':
        return this.initialize(message);
      case 'execute':
        return this.execute(message);
      case 'callback':
        return this.callback(message);
      case 'exit':
        return this.exit(message);
      default:
        throw new Error('invalid message');
    }
  };
}

const worker = new Worker();

process.on('message', worker.handleMessage);
