'use strict';

var _slicedToArray = function () { function sliceIterator(arr, i) { var _arr = []; var _n = true; var _d = false; var _e = undefined; try { for (var _i = arr[Symbol.iterator](), _s; !(_n = (_s = _i.next()).done); _n = true) { _arr.push(_s.value); if (i && _arr.length === i) break; } } catch (err) { _d = true; _e = err; } finally { try { if (!_n && _i["return"]) _i["return"](); } finally { if (_d) throw _e; } } return _arr; } return function (arr, i) { if (Array.isArray(arr)) { return arr; } else if (Symbol.iterator in Object(arr)) { return sliceIterator(arr, i); } else { throw new TypeError("Invalid attempt to destructure non-iterable instance"); } }; }();

global._tryCallback = func => {
  try {
    func();
  } catch (ex) {
    global.setResult({
      error: {
        name: ex.name,
        message: ex.message,
        stack: ex.stack
      }
    });
  }
};

global._execute = () => {
  global._tryCallback(() => {
    eval(global._code);
  });
};

global.dispatchSync = (name, args) => {
  const parameters = [JSON.stringify([name, ...args])];

  const result = global._dispatchSync.apply(global, parameters);

  if (result == null) {
    return null;
  }

  var _JSON$parse = JSON.parse(result),
      _JSON$parse2 = _slicedToArray(_JSON$parse, 2);

  const error = _JSON$parse2[0],
        value = _JSON$parse2[1];


  if (error) {
    throw new Error(error.message);
  }

  return value;
};

global.dispatchAsync = (name, args, callback) => {
  if (typeof callback !== 'function') {
    callback = () => {};
  }

  const parameters = [JSON.stringify([name, ...args])];

  const wrappedCallback = args => {
    global._tryCallback(() => {
      callback.apply(null, JSON.parse(args));
    });
  };

  parameters.push(wrappedCallback);

  const result = global._dispatchAsync.apply(global, parameters);

  return result != null ? JSON.parse(result) : null;
};

global.httpRequest = (options, callback) => {
  const parameters = [JSON.stringify([options])];

  if (callback) {
    const wrappedCallback = args => {
      global._tryCallback(() => {
        callback.apply(null, JSON.parse(args));
      });
    };

    parameters.push(wrappedCallback);
  }

  const result = global._httpRequest.apply(global, parameters);

  if (result == null) {
    return null;
  }

  var _JSON$parse3 = JSON.parse(result),
      _JSON$parse4 = _slicedToArray(_JSON$parse3, 2);

  const error = _JSON$parse4[0],
        response = _JSON$parse4[1];


  if (!callback && error) {
    throw new Error(error.message);
  }

  return response;
};

global.setResult = result => {
  return global._setResult(result != null ? JSON.stringify(result) : null);
};

global.setTimeout = (callback, timeout) => {
  const handler = () => {
    global._tryCallback(callback);
  };

  return global._setTimeout(handler, timeout);
};

global.clearTimeout = id => {
  return global._clearTimeout(id);
};

global.console = {
  log: function log() {
    for (var _len = arguments.length, args = Array(_len), _key = 0; _key < _len; _key++) {
      args[_key] = arguments[_key];
    }

    global._log(JSON.stringify(args));
  },
  error: function error() {
    for (var _len2 = arguments.length, args = Array(_len2), _key2 = 0; _key2 < _len2; _key2++) {
      args[_key2] = arguments[_key2];
    }

    global._error(JSON.stringify(args));
  }
};
//# sourceMappingURL=runtime.js.map