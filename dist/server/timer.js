"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

let nextID = 0;
const TIMERS = {};

class Timer {
  constructor() {
    _defineProperty(this, "id", void 0);

    this.id = null;
  }

  clear() {
    if (this.id) {
      clearTimeout(TIMERS[this.id]);
      delete TIMERS[this.id];
      this.id = null;
    }
  }

  start(timeout, callback) {
    this.clear();
    this.id = ++nextID;
    TIMERS[this.id] = setTimeout(() => {
      delete TIMERS[this.id];
      this.id = null;
      callback();
    }, timeout == null ? 1e8 : timeout);
  }

  isRunning() {
    return this.id != null;
  }

}

exports.default = Timer;
//# sourceMappingURL=timer.js.map