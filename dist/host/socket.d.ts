/// <reference types="node" />
/// <reference types="node" />
/// <reference types="node" />
import net from 'net';
import { ChildProcess } from 'child_process';
import Sandbox from './sandbox';
interface Packet {
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
    packet: Packet;
    constructor(socket: any, sandbox: any);
    shutdown(): void;
    get isConnected(): boolean;
    handleData: (rawData: any) => void;
    handleError: (error: any) => void;
    handleDrain: () => void;
    handleClose: () => void;
    handleEnd: () => void;
}
export {};
