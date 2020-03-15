import fs from 'fs';
import path from 'path';

const NativeSandbox = require('bindings')('sandbox').Sandbox;

const RUNTIME = fs.readFileSync(path.join(__dirname, 'runtime.js')).toString();
// const LINECOUNT = RUNTIME.split('\n').length;

export default class Worker {
  constructor() {
    this.native = new NativeSandbox(process.argv[2]);
  }

  execute(message) {
    console.log('executing', process.argv[2], message);

    this.connect();

    const code = [ RUNTIME, message.code ].join('\n');

    this.native.execute(code, (result) => {
      process.send({ type: 'result', result });
    });
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

  callback(id, message) {
    this.native.callback(id, message);
  }

  handleMessage = (message) => {
    if (message.type === 'execute') {
      this.execute(message);
    } else if (message.type === 'callback') {
      this.callback(message.id, JSON.stringify(message.args));
    } else if (message.type === 'exit') {
      this.disconnect();
      process.off('message', worker.handleMessage);
    }
  }
}

const worker = new Worker();

process.on('message', worker.handleMessage);