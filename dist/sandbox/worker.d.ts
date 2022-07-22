export interface WorkerMessage {
    messageId: number;
    type: 'initialize' | 'execute' | 'callback' | 'cancel' | 'exit';
    template: string;
    code: string;
    globals: string;
    callbackId: string;
    args: string;
}
export default class Worker {
    native: any;
    connected: boolean;
    messageId: number;
    constructor();
    initialize({ messageId, template }: WorkerMessage): void;
    execute({ messageId, code, globals }: WorkerMessage): void;
    _execute(code: any): any;
    reset(force: any): void;
    connect(): void;
    disconnect(): void;
    finish(): void;
    cancel({ messageId, callbackId }: WorkerMessage): void;
    callback({ messageId, callbackId, args }: WorkerMessage): void;
    exit(message: WorkerMessage): void;
    handleMessage: (message: WorkerMessage) => void;
    beforeExit: () => void;
    ref: () => void;
    unref: () => void;
}
