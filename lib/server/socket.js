import EventEmitter from 'events';

function tryParseJSON(value) {
  try {
    return JSON.parse(value);
  } catch (ex) {
    return null;
  }
}

export default class Socket extends EventEmitter {
  constructor(socket, sandbox) {
    super();

    this.sandbox = sandbox;
    this.worker = sandbox.host.worker;
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
    // make sure the current host is the host we started with. The host might've
    // been replaced by the time this is invoked.
    return !this.closed && this.worker === this.sandbox.host.worker;
  }

  handleData = (data) => {
    const id = data.readInt32BE();
    const json = data.toString('utf8', 4);

    const message = tryParseJSON(json);

    const callback = (...args) => {
      if (this.isConnected) {
        this.sandbox.host.callback(id, args);
      }
    };

    const write = (result) => {
      const json = JSON.stringify({ id, result: result || { value: undefined } });
      const length = Buffer.byteLength(json, 'utf8');
      const buffer = Buffer.alloc(length + 4);
  
      buffer.writeInt32BE(length);
      buffer.write(json, 4);
  
      if (this.isConnected) {
        this.socket.write(buffer);
      }
    };

    const respond = (value) => {
      write({ value });
    }

    const fail = (error) => {
      write({
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack
        }
      });
    }

    try {
      if (message == null) {
        throw new Error('invalid dispatch');
      }

      this.sandbox.dispatch(message, { fail, respond, callback });
    } catch (ex) {
      fail(ex);
    }
  }

  handleError = (error) => {
    console.error('socket error', error);
  }

  handleDrain = () => {
    this.socket.resume();
  }

  handleClose = () => {
    this.closed = true;
  }

  handleEnd = () => {
    this.closed = true;
  }
}