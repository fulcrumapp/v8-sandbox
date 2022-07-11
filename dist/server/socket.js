"use strict";
exports.__esModule = true;
function tryParseJSON(value) {
    try {
        return JSON.parse(value);
    }
    catch (ex) {
        return null;
    }
}
var Socket = /** @class */ (function () {
    function Socket(socket, sandbox) {
        var _this = this;
        this.handleData = function (data) {
            if (!_this.message) {
                _this.message = {
                    id: data.readInt32BE(0),
                    length: data.readInt32BE(4),
                    json: data.toString('utf8', 8)
                };
            }
            else {
                _this.message.json += data.toString('utf8');
            }
            if (Buffer.byteLength(_this.message.json) === _this.message.length) {
                var _a = _this.message, id_1 = _a.id, json = _a.json;
                _this.message = null;
                var message = tryParseJSON(json);
                var callback = id_1 > 0 && (function () {
                    var args = [];
                    for (var _i = 0; _i < arguments.length; _i++) {
                        args[_i] = arguments[_i];
                    }
                    if (_this.isConnected) {
                        _this.sandbox.callback(id_1, args);
                    }
                });
                var write_1 = function (result) {
                    var string = JSON.stringify({ id: id_1, result: result || { value: undefined } });
                    var length = Buffer.byteLength(string, 'utf8');
                    var buffer = Buffer.alloc(length + 4);
                    buffer.writeInt32BE(length);
                    buffer.write(string, 4);
                    if (_this.isConnected) {
                        _this.socket.write(buffer);
                    }
                };
                var respond = function (value) {
                    write_1({ value: value });
                };
                var fail = function (error) {
                    write_1({
                        error: {
                            name: error.name,
                            message: error.message,
                            stack: error.stack
                        }
                    });
                };
                try {
                    if (message == null) {
                        throw new Error('invalid dispatch');
                    }
                    _this.sandbox.dispatch(message, { fail: fail, respond: respond, callback: callback });
                }
                catch (ex) {
                    fail(ex);
                }
            }
        };
        this.handleError = function (error) {
            console.error('socket error', error);
        };
        this.handleDrain = function () {
            _this.socket.resume();
        };
        this.handleClose = function () {
            _this.closed = true;
        };
        this.handleEnd = function () {
            _this.closed = true;
        };
        this.sandbox = sandbox;
        this.worker = sandbox.worker;
        this.socket = socket;
        this.socket.on('data', this.handleData);
        this.socket.on('end', this.handleEnd);
        this.socket.on('close', this.handleClose);
        this.socket.on('error', this.handleError);
        this.socket.on('drain', this.handleDrain);
    }
    Socket.prototype.shutdown = function () {
        if (this.socket) {
            this.closed = true;
            this.socket.end();
            this.socket.unref();
        }
    };
    Object.defineProperty(Socket.prototype, "isConnected", {
        get: function () {
            // make sure the current sandbox worker is the worker we started with. The worker might've
            // been replaced by the time this is invoked.
            return !this.closed && this.worker === this.sandbox.worker;
        },
        enumerable: false,
        configurable: true
    });
    return Socket;
}());
exports["default"] = Socket;
//# sourceMappingURL=socket.js.map