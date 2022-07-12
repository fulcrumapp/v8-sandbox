/// <reference types="node" />
import { ChildProcess } from 'child_process';
import async from 'async';
import { Options, ExecutionOptions } from '../host/sandbox';
interface ClusterOptions extends Options {
    workers?: number;
}
export default class Cluster {
    workerCount: number;
    inactiveWorkers: ChildProcess[];
    activeWorkers: ChildProcess[];
    queue?: async.QueueObject<ExecutionOptions>;
    sandboxOptions: Options;
    constructor({ workers, ...options }?: ClusterOptions);
    start(): void;
    shutdown(): void;
    worker: (task: any, callback: any) => void;
    ensureWorkers(): void;
    forkWorker(): ChildProcess;
    popWorker(callback: any): void;
    clearWorkerTimeout(worker: any): void;
    finishWorker(worker: any): void;
    removeWorker(worker: any): void;
    execute({ code, timeout, globals, context, }: ExecutionOptions): Promise<unknown>;
    _execute({ code, timeout, globals, context, }: {
        code: any;
        timeout: any;
        globals: any;
        context: any;
    }, callback: any): void;
}
export {};
