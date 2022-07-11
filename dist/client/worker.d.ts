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
    callback({ id, args }: {
        id: any;
        args: any;
    }): void;
    exit(message: any): void;
    handleMessage: (message: any) => void;
}
