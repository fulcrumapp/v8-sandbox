import path from 'path';
import { fork } from 'child_process';
import EventEmitter from 'events';

export default class Host extends EventEmitter {
  constructor(socketName) {
    super();

    this.socketName = socketName;
    this.fork();
  }

  fork() {
    this.kill();

    this.worker = fork(path.join(__dirname, '..', 'client', 'worker'), [ this.socketName ]);

    this.worker.on('error', (error) => {
      this.fork();
      this.emit('error', error);
    });

    this.worker.on('exit', () => {
      this.emit('exit');
    });
  }

  kill() {
    this.clearTimeout();

    if (this.worker) {
      this.worker.removeAllListeners();
      this.worker.kill();
      this.worker = null;
    }
  }

  clearTimeout() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  execute({ code, context, timeout }) {
    if (timeout > 0) {
      this.clearTimeout();

      this.timer = setTimeout(() => {
        this.fork();
        this.emit('timeout');
      }, timeout);
    }

    this.worker.send({ type: 'execute', code, context: JSON.stringify(context) });
  }

  callback(id, args) {
    this.worker.send({ type: 'callback', id, args });
  }
}