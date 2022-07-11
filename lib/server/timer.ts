// @ts-nocheck

let nextID = 0;

const TIMERS = {};

export default class Timer {
  id: number;

  constructor() {
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
