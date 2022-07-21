const environment: any = global;

environment.dispatch = (name, args, callback) => {
  if (typeof callback !== 'function') {
    callback = null;
  }

  const parameters = [name, JSON.stringify({ name, args: args ?? [] })];

  const wrappedCallback = callback && ((jsonArguments) => {
    if (callback) {
      callback(...JSON.parse(jsonArguments));
    }
  });

  parameters.push(wrappedCallback);

  const json = environment._dispatch(...parameters);

  const result = json != null ? JSON.parse(json).result : null;

  if (result && result.error) {
    const error = new Error(result.error.message);

    throw Object.assign(error, result.error);
  }

  return result != null ? result.value : null;
};

environment.httpRequest = (options, callback) => environment.dispatch('httpRequest', [options], callback);

environment.setResult = (result) => environment.dispatch('setResult', result != null ? [result] : null);

environment.setTimeout = (callback, timeout) => environment.dispatch('setTimeout', [timeout], callback);

environment.clearTimeout = (id) => environment.dispatch('clearTimeout', [id]);

environment.info = (id) => environment.dispatch('info', []);

environment.console = {
  log: (...args) => environment.dispatch('log', [args]),
  error: (...args) => environment.dispatch('error', [args]),
};

environment.define = (name) => {
  environment[name] = (...args) => environment.dispatch(name, args);
};

environment.defineAsync = (name) => {
  environment[name] = (...args) => {
    const callback = args.pop();

    return environment.dispatch(name, args, callback);
  };
};

const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const lookup = new Uint8Array(256);

for (let i = 0; i < chars.length; i++) {
  lookup[chars.charCodeAt(i)] = i;
}

environment.bufferToBase64 = (arrayBuffer) => {
  const bytes = new Uint8Array(arrayBuffer);
  const len = bytes.length;
  let base64 = '';

  for (let i = 0; i < len; i += 3) {
    base64 += chars[bytes[i] >> 2];
    base64 += chars[((bytes[i] & 3) << 4) | (bytes[i + 1] >> 4)];
    base64 += chars[((bytes[i + 1] & 15) << 2) | (bytes[i + 2] >> 6)];
    base64 += chars[bytes[i + 2] & 63];
  }

  if ((len % 3) === 2) {
    base64 = `${base64.substring(0, base64.length - 1)}=`;
  } else if (len % 3 === 1) {
    base64 = `${base64.substring(0, base64.length - 2)}==`;
  }

  return base64;
};

environment.base64ToBuffer = (base64) => {
  let bufferLength = base64.length * 0.75;

  const len = base64.length;

  let p = 0;
  let encoded1 = null;
  let encoded2 = null;
  let encoded3 = null;
  let encoded4 = null;

  if (base64[base64.length - 1] === '=') {
    bufferLength--;

    if (base64[base64.length - 2] === '=') {
      bufferLength--;
    }
  }

  const arrayBuffer = new ArrayBuffer(bufferLength);
  const bytes = new Uint8Array(arrayBuffer);

  for (let i = 0; i < len; i += 4) {
    encoded1 = lookup[base64.charCodeAt(i)];
    encoded2 = lookup[base64.charCodeAt(i + 1)];
    encoded3 = lookup[base64.charCodeAt(i + 2)];
    encoded4 = lookup[base64.charCodeAt(i + 3)];

    bytes[p++] = (encoded1 << 2) | (encoded2 >> 4);
    bytes[p++] = ((encoded2 & 15) << 4) | (encoded3 >> 2);
    bytes[p++] = ((encoded3 & 3) << 6) | (encoded4 & 63);
  }

  return arrayBuffer;
};
