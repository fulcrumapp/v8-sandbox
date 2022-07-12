import Sandbox, { Message } from './sandbox';
import Timer from './timer';
interface Timers {
    [key: string]: Timer;
}
interface CustomFunctions {
    [key: string]: Function;
}
export default class Functions {
    sandbox: Sandbox;
    require: string;
    httpEnabled: boolean;
    timersEnabled: boolean;
    timers: Timers;
    syncFunctions: CustomFunctions;
    asyncFunctions: CustomFunctions;
    constructor(sandbox: any, { require, httpEnabled, timersEnabled }: {
        require: any;
        httpEnabled: any;
        timersEnabled: any;
    });
    setup(): void;
    define: (name: any, fn: any) => void;
    defineAsync: (name: any, fn: any) => void;
    defines(): string[];
    clearTimers(): void;
    dispatch({ name, args }: {
        name: any;
        args: any;
    }, { message, fail, respond, callback, }: {
        message: any;
        fail: any;
        respond: any;
        callback: any;
    }): any;
    setResult([result]: [any], { message, respond }: {
        message: any;
        respond: any;
    }): void;
    setTimeout: ([timeout]: [any], { fail, respond, callback }: {
        fail: any;
        respond: any;
        callback: any;
    }) => any;
    clearTimeout: ([timerID]: [any], { fail, respond }: {
        fail: any;
        respond: any;
    }) => any;
    httpRequest: ([options]: [any], { respond, fail, callback }: {
        respond: any;
        fail: any;
        callback: any;
    }) => any;
    log: ([args]: [any], { message, respond, callback }: {
        message: any;
        respond: any;
        callback: any;
    }) => void;
    write({ message, type, args }: {
        message: Message;
        type: string;
        args: [any, any];
    }): void;
    error: ([args]: [any], { message, respond, callback }: {
        message: any;
        respond: any;
        callback: any;
    }) => void;
    info: (args: any, { message, fail, respond }: {
        message: any;
        fail: any;
        respond: any;
    }) => any;
    processHttpRequest(options: any): any;
    processHttpResponse(response: any): {
        body: any;
        status: any;
        statusText: any;
        headers: any;
    };
    processHttpError(err: any): {
        message: any;
        code: any;
        errno: any;
    };
}
export {};
