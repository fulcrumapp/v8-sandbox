/// <reference types="node" />
/// <reference types="node" />
import { ChildProcess } from 'child_process';
import async from 'async';
import { Result, Options, ExecutionOptions } from '../host/sandbox';
interface ClusterOptions extends Options {
    workers?: number;
}
interface ClusterWorker {
    childProcess: ChildProcess;
    executionTimeout?: NodeJS.Timeout | null;
}
export default class Cluster {
    workerCount: number;
    inactiveWorkers: ClusterWorker[];
    activeWorkers: ClusterWorker[];
    queue?: async.QueueObject<ExecutionOptions>;
    sandboxOptions: Options;
    constructor({ workers, ...options }?: ClusterOptions);
    execute({ code, timeout, globals, context, }: ExecutionOptions): Promise<Result>;
    shutdown(): void;
    start(): void;
    worker: (task: any, callback: any) => void;
    ensureWorkers(): void;
    forkWorker(): ChildProcess;
    popWorker(callback: (worker: ClusterWorker) => void): void;
    clearWorkerTimeout(worker: ClusterWorker): void;
    finishWorker(worker: ClusterWorker): void;
    removeWorker(worker: ClusterWorker): void;
    _execute({ code, timeout, globals, context, }: {
        code: any;
        timeout: any;
        globals: any;
        context: any;
    }, cb: any): void;
}
export {};
