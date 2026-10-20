import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { WebrtcProvider } from 'y-webrtc';
import { IndexeddbPersistence } from 'y-indexeddb';
import { Awareness } from 'y-protocols/awareness';
import { ConnectionStatus, TransportType } from './types';

const PUBLIC_WEBRTC_SIGNALING = [
  'wss://signaling.yjs.dev',
  'wss://y-webrtc-signaling-eu.herokuapp.com',
  'wss://y-webrtc-signaling-us.herokuapp.com',
];

export interface WhiteboardConnection {
  wsProvider: WebsocketProvider | null;
  webrtcProvider: WebrtcProvider | null;
  idbProvider: IndexeddbPersistence | null;
  awareness: Awareness;
  getStatus: () => ConnectionStatus;
  getTransport: () => TransportType;
  isStorageSynced: () => boolean;
  onStatusChange: (cb: (status: ConnectionStatus, transport: TransportType) => void) => () => void;
  destroy: () => void;
}

/**
 * Creates production-grade distributed Yjs provider:
 * 1. Offline-First Storage: y-indexeddb persists doc locally and merges seamlessly upon reconnect.
 * 2. Primary: y-websocket server with dynamic room routing (/collaboration/:roomId).
 * 3. Fallback: WebRTC + local BroadcastChannel when WebSocket server is unavailable/offline.
 * 4. Auto-reconnection with exponential backoff.
 */
export function createWhiteboardProvider(
  roomName: string,
  doc: Y.Doc,
  customWsUrl?: string
): WhiteboardConnection {
  if (typeof window === 'undefined') {
    const dummyAwareness = new Awareness(doc);
    return {
      wsProvider: null,
      webrtcProvider: null,
      idbProvider: null,
      awareness: dummyAwareness,
      getStatus: () => 'offline',
      getTransport: () => 'websocket',
      isStorageSynced: () => false,
      onStatusChange: () => () => {},
      destroy: () => {},
    };
  }

  // 1. Initialize Offline-First IndexedDB Persistence
  const idbProvider = new IndexeddbPersistence(`syncsketch-${roomName}`, doc);
  let isStorageSynced = false;

  idbProvider.on('synced', () => {
    isStorageSynced = true;
    console.log(`[SyncSketch IndexedDB] 💾 Document loaded and synced from local IndexedDB for "${roomName}"`);
  });

  const defaultWsBase =
    process.env.NEXT_PUBLIC_COLLAB_WS_URL ||
    (window.location.protocol === 'https:' ? 'wss:' : 'ws:') +
      `//${window.location.hostname}:1234/collaboration`;

  const wsServerUrl = customWsUrl || defaultWsBase;

  // Single shared Awareness instance bound to doc
  const awareness = new Awareness(doc);

  let currentStatus: ConnectionStatus = 'connecting';
  let currentTransport: TransportType = 'websocket';
  const statusSubscribers: Set<(status: ConnectionStatus, transport: TransportType) => void> = new Set();

  const notifyStatus = (status: ConnectionStatus, transport: TransportType) => {
    currentStatus = status;
    currentTransport = transport;
    statusSubscribers.forEach((cb) => cb(status, transport));
  };

  let webrtcProvider: WebrtcProvider | null = null;
  let fallbackTimer: NodeJS.Timeout | null = null;
  let isDestroyed = false;

  // Initialize WebRTC fallback lazily
  const enableWebRTCFallback = () => {
    if (isDestroyed || webrtcProvider) return;
    try {
      console.log(`[SyncSketch Client] 🔄 Activating WebRTC fallback for room "${roomName}"...`);
      webrtcProvider = new WebrtcProvider(roomName, doc, {
        signaling: PUBLIC_WEBRTC_SIGNALING,
        awareness,
        filterBcConns: false,
      });
      notifyStatus('reconnecting', 'webrtc');
    } catch (e: any) {
      console.warn('[SyncSketch Client] WebRTC fallback initialization error:', e);
    }
  };

  const disableWebRTCFallback = () => {
    if (webrtcProvider) {
      try {
        console.log(`[SyncSketch Client] ⚡ WebSocket connected. Disconnecting WebRTC fallback.`);
        webrtcProvider.destroy();
        webrtcProvider = null;
      } catch {}
    }
  };

  // 2. Instantiate primary WebSocket provider
  console.log(`[SyncSketch Client] 🔌 Connecting to WebSocket: ${wsServerUrl}/${roomName}`);
  const wsProvider = new WebsocketProvider(wsServerUrl, roomName, doc, {
    awareness,
    maxBackoffTime: 5000,
    resyncInterval: 15000,
  });

  // If server does not respond within 3 seconds, activate P2P WebRTC fallback
  fallbackTimer = setTimeout(() => {
    if (currentStatus !== 'connected') {
      enableWebRTCFallback();
    }
  }, 3000);

  // Monitor WebSocket status
  wsProvider.on('status', (event: { status: 'connected' | 'connecting' | 'disconnected' }) => {
    if (isDestroyed) return;

    if (event.status === 'connected') {
      if (fallbackTimer) {
        clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
      disableWebRTCFallback();
      notifyStatus('connected', 'websocket');
    } else if (event.status === 'connecting') {
      notifyStatus('connecting', currentTransport);
    } else if (event.status === 'disconnected') {
      enableWebRTCFallback();
      notifyStatus('reconnecting', webrtcProvider ? 'webrtc' : 'websocket');
    }
  });

  wsProvider.on('connection-error', () => {
    if (isDestroyed) return;
    enableWebRTCFallback();
    notifyStatus('reconnecting', webrtcProvider ? 'webrtc' : 'websocket');
  });

  wsProvider.on('connection-close', () => {
    if (isDestroyed) return;
    enableWebRTCFallback();
    notifyStatus('reconnecting', webrtcProvider ? 'webrtc' : 'websocket');
  });

  return {
    wsProvider,
    webrtcProvider,
    idbProvider,
    awareness,
    getStatus: () => currentStatus,
    getTransport: () => currentTransport,
    isStorageSynced: () => isStorageSynced,
    onStatusChange: (cb) => {
      statusSubscribers.add(cb);
      cb(currentStatus, currentTransport);
      return () => {
        statusSubscribers.delete(cb);
      };
    },
    destroy: () => {
      isDestroyed = true;
      if (fallbackTimer) clearTimeout(fallbackTimer);
      statusSubscribers.clear();
      disableWebRTCFallback();
      wsProvider.destroy();
      idbProvider.destroy();
      awareness.destroy();
    },
  };
}
