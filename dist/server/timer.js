"use strict";
exports.__esModule = true;
var nextID = 0;
var TIMERS = {};
var Timer = /** @class */ (function () {
    function Timer() {
        this.id = null;
    }
    Timer.prototype.clear = function () {
        if (this.id) {
            clearTimeout(TIMERS[this.id]);
            delete TIMERS[this.id];
            this.id = null;
        }
    };
    Timer.prototype.start = function (timeout, callback) {
        var _this = this;
        this.clear();
        this.id = ++nextID;
        TIMERS[this.id] = setTimeout(function () {
            delete TIMERS[_this.id];
            _this.id = null;
            callback();
        }, timeout == null ? 1e8 : timeout);
    };
    Timer.prototype.isRunning = function () {
        return this.id != null;
    };
    return Timer;
}());
exports["default"] = Timer;
//# sourceMappingURL=timer.js.map