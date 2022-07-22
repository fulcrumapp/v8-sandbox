import { fork, ChildProcess } from 'child_process';
import path from 'path';
import async from 'async';
import onExit from 'signal-exit';
import { once } from 'lodash';
import {
  Result, Options, ExecutionOptions, TimeoutError,
} from '../host/sandbox';

interface ClusterOptions extends Options {
  workers?: number;
}

function remove(array, object) {
  const index = array.indexOf(object);

  if (index > -1) {
    array.splice(index, 1);
  }
}

interface ClusterWorker {
  childProcess: ChildProcess;
  executionTimeout?: NodeJS.Timeout | null;
}

export default class Cluster {
  workerCount: number;

  inactiveWorkers: ClusterWorker[] = [];

  activeWorkers: ClusterWorker[] = [];

  queue?: async.QueueObject<ExecutionOptions>;

  sandboxOptions: Options;

  constructor({ workers, ...options }: ClusterOptions = {}) {
    this.workerCount = workers ?? 1;
    this.sandboxOptions = options;
    this.start();
  }

  execute({
    code, timeout, globals, context,
  }: ExecutionOptions): Promise<Result> {
    return new Promise<Result>((resolve, reject) => {
      const item = {
        code,
        timeout,
        globals: globals || {},
        context: context || {},
      };

      if (!this.queue) {
        throw new Error('invalid queue');
      }

      this.queue.push(item, resolve);
    });
  }

  shutdown() {
    for (const worker of this.inactiveWorkers) {
      this.clearWorkerTimeout(worker);
      worker.childProcess.removeAllListeners();
      worker.childProcess.kill();
    }

    for (const worker of this.activeWorkers) {
      this.clearWorkerTimeout(worker);
      worker.childProcess.removeAllListeners();
      worker.childProcess.kill();
    }

    this.inactiveWorkers = [];
    this.activeWorkers = [];

    if (this.queue) {
      this.queue.kill();
    }

    this.queue = async.queue(this.worker, this.workerCount);
  }

  start() {
    this.inactiveWorkers = [];
    this.activeWorkers = [];
    this.queue = async.queue(this.worker, this.workerCount);
    this.ensureWorkers();

    onExit((code, signal) => {
      this.shutdown();
    });
  }

  worker = (task, callback) => {
    this._execute(task, callback);
  };

  ensureWorkers() {
    const total = this.inactiveWorkers.length + this.activeWorkers.length;

    for (let i = 0; i < this.workerCount - total; ++i) {
      const childProcess = this.forkWorker();

      childProcess.send({ initialize: true, ...this.sandboxOptions });

      this.inactiveWorkers.push({ childProcess });
    }
  }

  forkWorker() {
    return fork(path.join(__dirname, 'worker'), [], {
      execArgv: [], gid: this.sandboxOptions.gid, uid: this.sandboxOptions.uid,
    });
  }

  popWorker(callback: (worker: ClusterWorker) => void) {
    this.ensureWorkers();

    if (this.inactiveWorkers.length === 0) {
      setImmediate(() => {
        this.popWorker(callback);
      });

      return;
    }

    const worker = this.inactiveWorkers.shift();

    if (worker == null) {
      throw new Error('no inactive worker');
    }

    this.activeWorkers.push(worker);

    if (this.activeWorkers.length + this.inactiveWorkers.length !== this.workerCount) {
      throw new Error('invalid worker count');
    }

    callback(worker);
  }

  clearWorkerTimeout(worker: ClusterWorker) {
    if (worker.executionTimeout) {
      clearTimeout(worker.executionTimeout);
    }

    worker.executionTimeout = null;
  }

  finishWorker(worker: ClusterWorker) {
    this.clearWorkerTimeout(worker);
    remove(this.activeWorkers, worker);
    this.inactiveWorkers.push(worker);
  }

  removeWorker(worker: ClusterWorker) {
    this.clearWorkerTimeout(worker);

    worker.childProcess.kill();
    worker.childProcess.removeAllListeners();

    remove(this.activeWorkers, worker);
    remove(this.inactiveWorkers, worker);

    this.ensureWorkers();
  }

  _execute({
    code, timeout, globals, context,
  }, cb) {
    const callback = once(cb);

    this.popWorker((worker: ClusterWorker) => {
      worker.childProcess.removeAllListeners();

      worker.childProcess.on('message', (message) => {
        this.finishWorker(worker);

        callback(message);
      });

      worker.childProcess.on('error', (message) => {
        this.removeWorker(worker);

        callback({ error: new Error('worker error') });
      });

      worker.childProcess.on('disconnect', () => {
        this.removeWorker(worker);

        callback({ error: new Error('worker disconnected') });
      });

      worker.childProcess.on('exit', (message) => {
        this.removeWorker(worker);
      });

      if (timeout > 0) {
        worker.executionTimeout = setTimeout(() => {
          this.removeWorker(worker);
          callback({ error: new TimeoutError(timeout) });
        }, timeout);
      }

      worker.childProcess.send({
        code,
        globals: JSON.stringify(globals),
        context: JSON.stringify(context),
      });
    });
  }
}
