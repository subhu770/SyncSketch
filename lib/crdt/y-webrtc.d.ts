declare module 'y-webrtc' {
  import * as Y from 'yjs';
  import { Awareness } from 'y-protocols/awareness';

  export interface WebrtcProviderOptions {
    signaling?: string[];
    password?: string | null;
    awareness?: Awareness;
    maxConns?: number;
    filterBcConns?: boolean;
    peerOpts?: any;
  }

  export class WebrtcProvider {
    roomName: string;
    doc: Y.Doc;
    awareness: Awareness;
    connected: boolean;
    signalingConns: any[];

    constructor(
      roomName: string,
      doc: Y.Doc,
      opts?: WebrtcProviderOptions
    );

    connect(): void;
    disconnect(): void;
    destroy(): void;
    on(event: string, handler: (...args: any[]) => void): void;
    off(event: string, handler: (...args: any[]) => void): void;
  }
}
