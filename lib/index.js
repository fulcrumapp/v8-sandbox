import {fork} from 'child_process';
import path from 'path';

class TimeoutError extends Error {
  get isTimeout() {
    return true;
  }
}

export class Sandbox {
  execute(code, timeout, callback) {
    let executionTimeout = null;

    const child = fork(path.join(__dirname, 'worker'));

    child.on('message', (message) => {
      callback(message.err, message.value);
    });

    child.on('error', (message) => {
      clearTimeout(executionTimeout);
    });

    child.on('disconnect', () => {
      clearTimeout(executionTimeout);
    });

    child.on('exit', (message) => {
      clearTimeout(executionTimeout);
    });

    if (timeout > 0) {
      executionTimeout = setTimeout(() => {
        child.kill();
        callback(new TimeoutError('timeout'));
      }, timeout);
    }

    child.send({code});
  }
}
