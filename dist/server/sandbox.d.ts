/// <reference types="node" />
/// <reference types="node" />
import net from 'net';
import { ChildProcess } from 'child_process';
import async from 'async';
import Timer from './timer';
import Socket from './socket';
import Functions from './functions';
export interface Log {
    type: string;
    time: Date;
    message: string;
}
export interface Result {
    value?: any;
    error?: {
        name: string;
        message: string;
        stack: string;
    };
    output?: Log[];
}
export interface Message {
    type: 'initialize' | 'execute';
    template?: string;
    code?: string;
    globals?: object;
    context?: object;
    output: Log[];
    timeout: number;
    callback: Function;
}
export interface Options {
    require?: string;
    template?: string;
    httpEnabled?: boolean;
    timersEnabled?: boolean;
    memory?: number;
    argv?: string[];
    debug?: boolean;
    uid?: number;
    gid?: number;
    socketPath?: string;
}
export interface ExecutionOptions {
    code: string;
    timeout?: number;
    globals?: object;
    context?: object;
}
export declare class TimeoutError extends Error {
    constructor(timeout: any);
    get isTimeout(): boolean;
}
export default class Sandbox {
    id: string;
    template: string;
    initializeTimeout: Timer;
    argv: string[];
    executeTimeout: Timer;
    server: net.Server;
    worker: ChildProcess;
    initialized: boolean;
    socket: Socket;
    queue: async.AsyncQueue<Message>;
    message: Message;
    functions: Functions;
    running: boolean;
    debug: boolean;
    memory: number;
    uid: number;
    gid: number;
    socketPath: string;
    constructor({ require, template, httpEnabled, timersEnabled, memory, argv, uid, gid, debug, socketPath, }?: Options);
    initialize({ timeout }?: {
        timeout: null;
    }): Promise<Result>;
    execute({ code, timeout, globals, context, }: ExecutionOptions): Promise<unknown>;
    get socketName(): string;
    dispatch(invocation: any, { fail, respond, callback }: {
        fail: any;
        respond: any;
        callback: any;
    }): void;
    fork(): void;
    kill(): void;
    cleanupSocket(): void;
    start(): void;
    shutdown(): Promise<unknown>;
    handleTimeout: () => void;
    callback(id: any, args: any): void;
    processMessage: (message: Message) => Promise<unknown>;
    onInitialize({ template, timeout }: Message): void;
    onExecute({ code, timeout, globals, context, }: Message): void;
    finish(result: any): void;
    handleConnection: (socket: any) => void;
    handleError: (error: any) => void;
}
