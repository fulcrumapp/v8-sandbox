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
    }, { message, fail, respond, callback, cancel, }: {
        message: any;
        fail: any;
        respond: any;
        callback: any;
        cancel: any;
    }): any;
    finish([]: Iterable<any>, { message, respond }: {
        message: any;
        respond: any;
    }): void;
    setResult([result]: [any], { message, respond }: {
        message: any;
        respond: any;
    }): void;
    setTimeout: ([timeout]: [any], { fail, respond, callback, cancel, }: {
        fail: any;
        respond: any;
        callback: any;
        cancel: any;
    }) => any;
    clearTimeout: ([timerID]: [any], { fail, respond }: {
        fail: any;
        respond: any;
    }) => any;
    httpRequest: ([options]: [any], { respond, fail, callback, context, }: {
        respond: any;
        fail: any;
        callback: any;
        context: any;
    }) => any;
    log: ([args]: [any], { message, respond, context, callback, }: {
        message: any;
        respond: any;
        context: any;
        callback: any;
    }) => void;
    write({ message, type, args }: {
        message: Message;
        type: string;
        args: [any, any];
    }): void;
    error: ([args]: [any], { message, respond, context, callback, }: {
        message: any;
        respond: any;
        context: any;
        callback: any;
    }) => void;
    info: (args: any, { message, fail, respond }: {
        message: any;
        fail: any;
        respond: any;
    }) => any;
    processHttpRequest(rawOptions: any, context: any): any;
    processHttpResponse(rawResponse: any, context: any): any;
    processHttpError(rawError: any, context: any): any;
    handleConsoleLog: ({ args, context }: {
        args: any;
        context: any;
    }) => void;
    handleConsoleError: ({ args, context }: {
        args: any;
        context: any;
    }) => void;
    handleHttpRequest: ({ options, rawOptions, context }: {
        options: any;
        rawOptions: any;
        context: any;
    }) => any;
    handleHttpResponse: ({ response, rawResponse, context }: {
        response: any;
        rawResponse: any;
        context: any;
    }) => any;
    handleHttpError: ({ error, rawError, context }: {
        error: any;
        rawError: any;
        context: any;
    }) => any;
}
export {};
