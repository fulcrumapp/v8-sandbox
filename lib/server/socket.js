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
    this.socket.on('error', this.handleError);
    this.socket.on('drain', this.handleDrain);
  }

  shutdown() {
    if (this.socket) {
      this.socket.end();
      this.socket.unref();
    }
  }

  handleData = (data) => {
    const id = data.readInt32BE();
    const json = data.toString('utf8', 4);

    const message = tryParseJSON(json);

    const callback = (...args) => {
      // make sure the current host is the host we started with. The host might've
      // been replaced by the time this is invoked.
      if (this.worker === this.sandbox.host.worker) {
        this.sandbox.host.callback(id, args);
      }
    };

    const respond = (result) => {
      const json = JSON.stringify({ id, result: result || { value: null } });
      const length = Buffer.byteLength(json, 'utf8');
      const buffer = Buffer.alloc(length + 4);
  
      buffer.writeInt32BE(length);
      buffer.write(json, 4);
  
      this.socket.write(buffer);
    }

    try {
      if (message == null) {
        throw new Error('invalid dispatch');
      }

      this.sandbox.dispatch(message, respond, callback);
    } catch (ex) {
      return respond({
        error: {
          name: ex.name,
          message: ex.message,
          stack: ex.stack
        }
      });
    }
  }

  handleError = (error) => {
    console.error('socket error', error);
  }

  handleDrain = () => {
    this.socket.resume();
  }
}