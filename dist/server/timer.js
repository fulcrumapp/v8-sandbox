"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

class Timer {
  constructor() {
    this.id = null;
  }

  clear() {
    if (this.id) {
      clearTimeout(this.id);
      this.id = null;
    }
  }

  start(timeout, callback) {
    this.clear();
    this.id = setTimeout(() => {
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