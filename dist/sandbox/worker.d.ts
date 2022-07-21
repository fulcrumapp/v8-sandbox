export default class Worker {
    native: any;
    connected: boolean;
    constructor();
    initialize({ template }: {
        template: any;
    }): void;
    execute({ code, globals }: {
        code: any;
        globals: any;
    }): void;
    _execute(code: any): any;
    reset(force: any): void;
    connect(): void;
    disconnect(): void;
    finish(): void;
    cancel({ id }: {
        id: any;
    }): void;
    callback({ id, args }: {
        id: any;
        args: any;
    }): void;
    exit(message: any): void;
    handleMessage: (message: any) => void;
    beforeExit: (code: any) => void;
    ref: () => void;
    unref: () => void;
}
