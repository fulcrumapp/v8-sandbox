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
export interface ExecutionError {
    name: string;
    message: string;
    stack: string;
    exception: any;
    lineNumber: number;
    startColumn: number;
    endColumn: number;
    startPosition: number;
    endPosition: number;
    sourceLine: string;
    isTimeout?: boolean;
    code?: string;
}
export interface Result {
    value?: any;
    error?: ExecutionError;
    output?: Log[];
}
export interface Message {
    id: number;
    type: 'initialize' | 'execute';
    template?: string;
    code?: string;
    globals?: object;
    context?: object;
    output: Log[];
    timeout?: number;
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
    constructor(timeout: number);
    get isTimeout(): boolean;
}
export default class Sandbox {
    id: string;
    template: string;
    initializeTimeout: Timer;
    argv: string[];
    executeTimeout: Timer;
    server?: net.Server;
    worker?: ChildProcess;
    initialized: boolean;
    socket?: Socket;
    queue?: async.QueueObject<Message>;
    message?: Message;
    functions: Functions;
    running: boolean;
    debug: boolean;
    memory: number | null;
    uid: number | null;
    gid: number | null;
    socketPath: string;
    result: Result;
    constructor({ require, template, httpEnabled, timersEnabled, memory, argv, uid, gid, debug, socketPath, }?: Options);
    initialize({ timeout }?: {
        timeout: any;
    }): Promise<Result>;
    execute({ code, timeout, globals, context, }: ExecutionOptions): Promise<Result>;
    get socketName(): string;
    dispatch(messageId: any, invocation: any, { fail, respond, callback, cancel, }: {
        fail: any;
        respond: any;
        callback: any;
        cancel: any;
    }): void;
    fork(): void;
    kill(): void;
    cleanupSocket(): void;
    start(): void;
    shutdown(): Promise<unknown>;
    handleTimeout: () => void;
    callback(messageId: any, callbackId: any, args: any): void;
    cancel(messageId: any, callbackId: any): void;
    processMessage: (message: Message) => Promise<void>;
    onInitialize({ id, template, timeout }: Message): void;
    onExecute({ id, code, timeout, globals, context, }: Message): void;
    setResult(result: any): void;
    finish(result: any): void;
    handleConnection: (socket: any) => void;
    handleError: (error: any) => void;
}
