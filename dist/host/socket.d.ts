/// <reference types="node" />
/// <reference types="node" />
/// <reference types="node" />
import net from 'net';
import { ChildProcess } from 'child_process';
import Sandbox from './sandbox';
interface Message {
    messageId: number;
    callbackId: number;
    length: number;
    data: Buffer;
}
export default class Socket {
    sandbox: Sandbox;
    worker: ChildProcess;
    socket: net.Socket;
    closed: boolean;
    message: Message;
    constructor(socket: any, sandbox: any);
    shutdown(): void;
    get isConnected(): boolean;
    handleData: (data: any) => void;
    handleError: (error: any) => void;
    handleDrain: () => void;
    handleClose: () => void;
    handleEnd: () => void;
}
export {};
