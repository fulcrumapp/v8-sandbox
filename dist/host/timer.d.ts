export default class Timer {
    id: number;
    onCancel: Function;
    constructor();
    clear(): void;
    start(timeout: any, callback: any, cancel?: any): void;
    isRunning(): boolean;
}
