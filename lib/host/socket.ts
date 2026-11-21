import net from 'net';
import once from '../once';
import { ChildProcess } from 'child_process';
import Sandbox, { HostError } from './sandbox';

const MAX_IPC_FRAME_BYTES = 64 * 1024 * 1024;

function tryParseJSON(value) {
  try {
    return JSON.parse(value);
  } catch (ex) {
    return null;
  }
}

export default class Socket {
  sandbox: Sandbox;

  worker: ChildProcess;

  socket: net.Socket;

  closed: boolean;

  buffer: Buffer;

  constructor(socket, sandbox) {
    this.sandbox = sandbox;
    this.worker = sandbox.worker;
    this.socket = socket;
    this.closed = false;
    this.buffer = Buffer.alloc(0);
    this.socket.on('data', this.handleData);
    this.socket.on('end', this.handleEnd);
    this.socket.on('close', this.handleClose);
    this.socket.on('error', this.handleError);
    this.socket.on('drain', this.handleDrain);
  }

  shutdown() {
    if (this.socket) {
      this.closed = true;
      this.socket.end();
      this.socket.unref();
    }
  }

  get isConnected() {
    // make sure the current sandbox worker is the worker we started with. The worker might've
    // been replaced by the time this is invoked.
    return !this.closed && this.worker === this.sandbox.worker;
  }

  handleData = (rawData: Buffer) => {
    this.buffer = this.buffer.length === 0 ? rawData : Buffer.concat([this.buffer, rawData]);

    while (this.buffer.length >= 12) {
      const messageId = this.buffer.readInt32BE(0);
      const callbackId = this.buffer.readInt32BE(4);
      const length = this.buffer.readInt32BE(8);

      if (length < 0 || length > MAX_IPC_FRAME_BYTES) {
        this.closed = true;
        this.buffer = Buffer.alloc(0);
        this.socket.destroy();
        return;
      }

      if (this.buffer.length < 12 + length) {
        return;
      }

      const data = this.buffer.subarray(12, 12 + length);
      this.buffer = this.buffer.subarray(12 + length);

      const json = data.toString('utf8');
      const invocation = tryParseJSON(json);

      const callback = callbackId > 0 ? once(((...args) => {
        if (this.isConnected) {
          this.sandbox.callback(messageId, callbackId, args);
        }
      })) : null;

      const cancel = callbackId > 0 ? once((() => {
        if (this.isConnected) {
          this.sandbox.cancel(messageId, callbackId);
        }
      })) : null;

      const write = once((result) => {
        let string: string;
        try {
          string = JSON.stringify({ result: result ?? { value: undefined } });
        } catch (serializationError) {
          string = JSON.stringify({
            result: {
              error: {
                isHost: true,
                name: 'Error',
                message: serializationError instanceof Error
                  ? serializationError.message
                  : 'failed to serialize response',
              },
            },
          });
        }

        const byteLength = Buffer.byteLength(string, 'utf8');
        const buffer = Buffer.alloc(byteLength + 4);

        buffer.writeInt32BE(byteLength);
        buffer.write(string, 4);

        if (this.isConnected) {
          this.socket.write(buffer);
        }
      });

      const respond = (value) => {
        write({ value });
      };

      const fail = once((error) => {
        if (cancel) {
          cancel();
        }

        const err = error != null && typeof error === 'object'
          ? error
          : new HostError(error != null ? String(error) : 'host error');

        const payload: Record<string, any> = {
          ...err,
          isHost: true,
          name: err.name,
          message: err.message,
        };

        if (this.sandbox.debug && err.stack) {
          payload.stack = err.stack;
        } else {
          delete payload.stack;
        }

        write({ error: payload });
      });

      try {
        if (invocation == null || typeof invocation !== 'object' || Array.isArray(invocation)) {
          throw new HostError('invalid dispatch');
        }

        this.sandbox.dispatch(messageId, invocation, {
          fail, respond, callback, cancel,
        });
      } catch (ex) {
        fail(ex);
      }
    }
  };

  handleError = (error) => {
    console.error('socket error', error);
  };

  handleDrain = () => {
    this.socket.resume();
  };

  handleClose = () => {
    this.closed = true;
  };

  handleEnd = () => {
    this.closed = true;
  };
}
