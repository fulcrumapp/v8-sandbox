import path from 'path';
import { fork } from 'child_process';
import EventEmitter from 'events';
import Timer from './timer';

export default class Host extends EventEmitter {
  constructor(socketName) {
    super();

    this.socketName = socketName;

    this.initializeTimeout = new Timer();
    this.executeTimeout = new Timer();

    this.fork();
  }

  fork() {
    this.kill();

    this.worker = fork(path.join(__dirname, '..', 'client', 'worker'), [ this.socketName ]);

    console.log('forkworker', this.worker.pid);
    
    this.worker.on('error', (error) => {
      this.fork();
      this.emit('error', error);
    });

    this.worker.on('exit', () => {
      this.emit('exit');
    });
  }

  kill() {
    this.initializeTimeout.clear();
    this.executeTimeout.clear();

    if (this.worker) {
      console.log('killworker', this.worker.pid);

      this.worker.removeAllListeners();
      this.worker.kill();
      this.worker = null;
    }
  }

  handleTimeout = () => {
    this.fork();
    this.emit('timeout');
  }

  process(item) {
    switch (item.type) {
      case 'initialize':
        return this.initialize(item);
      case 'execute':
        return this.execute(item);
      default:
        throw new Error('invalid item');
    }
  }

  initialize({ template, timeout }) {
    this.initializeTimeout.start(timeout, this.handleTimeout);
    
    this.worker.send({ type: 'initialize', template: template || '' });
  }

  execute({ code, context, timeout }) {
    this.executeTimeout.start(timeout, this.handleTimeout);

    this.worker.send({ type: 'execute', code, context: JSON.stringify(context) });
  }

  callback(id, args) {
    this.worker.send({ type: 'callback', id, args });
  }
}