import net from 'net';
import { once } from 'lodash';
import { ChildProcess } from 'child_process';
import Sandbox from './sandbox';

function tryParseJSON(value) {
  try {
    return JSON.parse(value);
  } catch (ex) {
    return null;
  }
}

interface Packet {
  messageId: number;
  callbackId: number;
  length: number;
  data: Buffer;
}

export default class Socket {
  sandbox: Sandbox;

  worker: ChildProcess;

  socket: net.Socket;

  closed: boolean;

  packet: Packet;

  constructor(socket, sandbox) {
    this.sandbox = sandbox;
    this.worker = sandbox.worker;
    this.socket = socket;
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

  handleData = (rawData) => {
    if (!this.packet) {
      this.packet = {
        messageId: rawData.readInt32BE(0),
        callbackId: rawData.readInt32BE(4),
        length: rawData.readInt32BE(8),
        data: rawData.subarray(12),
      };
    } else {
      this.packet.data = Buffer.concat([this.packet.data, rawData]);
    }

    if (this.packet.data.length === this.packet.length) {
      const { messageId, callbackId, data } = this.packet;

      const json = data.toString('utf8');

      this.packet = null;

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
        const string = JSON.stringify({ result: result ?? { value: undefined } });
        const length = Buffer.byteLength(string, 'utf8');
        const buffer = Buffer.alloc(length + 4);

        buffer.writeInt32BE(length);
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

        write({
          error: {
            name: error.name,
            message: error.message,
            stack: error.stack,
          },
        });
      });

      try {
        if (invocation == null) {
          throw new Error('invalid dispatch');
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
