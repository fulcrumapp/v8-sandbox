"use strict";
// @ts-nocheck
Object.defineProperty(exports, "__esModule", { value: true });
let nextID = 0;
const TIMERS = {};
class Timer {
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
exports.default = Timer;
//# sourceMappingURL=timer.js.map