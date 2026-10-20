import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { WebSocket } from 'ws';
import { RedisPubSubAdapter } from './redis';
import { dbManager } from './db';

export const REDIS_ORIGIN = 'syncsketch-redis-cluster';

export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;
export const MESSAGE_AUTH = 2;
export const MESSAGE_QUERY_AWARENESS = 3;

// Snapshot thresholds per requirements:
// Every 30 seconds of active mutation activity, or after 50 mutations
export const SNAPSHOT_MUTATION_THRESHOLD = 50;
export const SNAPSHOT_DEBOUNCE_MS = 30 * 1000; // 30 seconds

export class CollabRoom {
  public roomId: string;
  public doc: Y.Doc;
  public awareness: awarenessProtocol.Awareness;
  public conns: Map<WebSocket, Set<number>> = new Map();
  private redisAdapter: RedisPubSubAdapter;
  private lastActive: number = Date.now();

  // Automated Snapshotting State
  private mutationCounter: number = 0;
  private snapshotTimer: NodeJS.Timeout | null = null;
  private isSnapshotting: boolean = false;
  private lastSnapshotVersion: number = 0;

  constructor(roomId: string, redisAdapter: RedisPubSubAdapter) {
    this.roomId = roomId;
    this.redisAdapter = redisAdapter;
    this.doc = new Y.Doc();
    this.awareness = new awarenessProtocol.Awareness(this.doc);

    this.setupDocListeners();
    this.setupAwarenessListeners();
    this.setupRedisSubscription();
  }

  /**
   * Factory Method: Asynchronously create room and restore latest binary snapshot
   * from PostgreSQL before any WebSocket client connections are accepted.
   */
  public static async create(roomId: string, redisAdapter: RedisPubSubAdapter): Promise<CollabRoom> {
    const room = new CollabRoom(roomId, redisAdapter);

    try {
      // Cold-storage restore from PostgreSQL / Disk
      const restored = await dbManager.getLatestSnapshot(roomId);
      if (restored && restored.snapshotBytes.length > 0) {
        // Initialize Y.Doc directly with stored binary update
        Y.applyUpdate(room.doc, restored.snapshotBytes, 'SNAPSHOT_INIT');
        room.lastSnapshotVersion = restored.version;
        console.log(
          `💾 [SyncSketch Room "${roomId}"] Restored from ${restored.storage} snapshot (v${restored.version}, ${restored.elementCount} elements, ${restored.snapshotBytes.length} bytes)`
        );
      } else {
        console.log(`✨ [SyncSketch Room "${roomId}"] Fresh room initialized (no prior snapshots)`);
      }
    } catch (err: any) {
      console.error(`[SyncSketch Room "${roomId}"] Failed to restore snapshot:`, err?.message || err);
    }

    return room;
  }

  private setupDocListeners() {
    this.doc.on('update', (update: Uint8Array, origin: any) => {
      this.lastActive = Date.now();

      // Broadcast document update to local connected clients
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      const message = encoding.toUint8Array(encoder);

      this.conns.forEach((_, conn) => {
        if (conn !== origin && conn.readyState === WebSocket.OPEN) {
          this.sendSafe(conn, message);
        }
      });

      // If update was created locally (not from Redis cluster or cold init), publish to Redis
      if (origin !== REDIS_ORIGIN && origin !== 'SNAPSHOT_INIT') {
        this.redisAdapter.publishDocUpdate(this.roomId, update);

        // Schedule / trigger debounced snapshotting
        this.onMutationActivity();
      }
    });
  }

  /**
   * Debounced & threshold-based snapshot engine
   * Triggers when:
   * 1. 50 active mutations accumulate.
   * 2. Or every 30 seconds of active mutation activity.
   */
  private onMutationActivity() {
    this.mutationCounter++;

    // Threshold trigger: 50 mutations accumulated
    if (this.mutationCounter >= SNAPSHOT_MUTATION_THRESHOLD) {
      if (this.snapshotTimer) {
        clearTimeout(this.snapshotTimer);
        this.snapshotTimer = null;
      }
      this.mutationCounter = 0;
      this.triggerSnapshot('threshold_50_mutations');
      return;
    }

    // Debounced timer: Every 30s of active mutation activity
    if (!this.snapshotTimer) {
      this.snapshotTimer = setTimeout(() => {
        this.snapshotTimer = null;
        if (this.mutationCounter > 0) {
          this.mutationCounter = 0;
          this.triggerSnapshot('timer_30s_debounce');
        }
      }, SNAPSHOT_DEBOUNCE_MS);
    }
  }

  /**
   * Capture and persist binary state update to PostgreSQL / cold storage
   */
  public async triggerSnapshot(triggerReason: string = 'manual'): Promise<void> {
    if (this.isSnapshotting) return;
    this.isSnapshotting = true;

    try {
      // 1. Encode binary document state
      const binaryState = Y.encodeStateAsUpdate(this.doc);

      // 2. Count active elements in shared canvas map
      const elementsMap = this.doc.getMap('canvasElements');
      const elementCount = elementsMap.size;

      // 3. Persist compressed buffer into PostgreSQL (or disk fallback)
      const meta = await dbManager.saveSnapshot(this.roomId, binaryState, elementCount);
      this.lastSnapshotVersion = meta.version;

      console.log(
        `📦 [Snapshot Persisted] Room "${this.roomId}" (v${meta.version}, ${meta.elementCount} elements, ${meta.sizeBytes} bytes, reason: ${triggerReason}, storage: ${meta.storage})`
      );
    } catch (err: any) {
      console.error(`[SyncSketch Room "${this.roomId}"] Snapshot error:`, err?.message || err);
    } finally {
      this.isSnapshotting = false;
    }
  }

  private setupAwarenessListeners() {
    this.awareness.on(
      'update',
      ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: any) => {
        const changedClients = added.concat(updated).concat(removed);
        const encodedUpdate = awarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClients);

        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(encoder, encodedUpdate);
        const message = encoding.toUint8Array(encoder);

        this.conns.forEach((_, conn) => {
          if (conn !== origin && conn.readyState === WebSocket.OPEN) {
            this.sendSafe(conn, message);
          }
        });

        // Publish awareness across cluster if originated locally
        if (origin !== REDIS_ORIGIN) {
          this.redisAdapter.publishAwarenessUpdate(this.roomId, encodedUpdate);
        }
      }
    );
  }

  private setupRedisSubscription() {
    this.redisAdapter.subscribeRoom(
      this.roomId,
      (remoteDocUpdate) => {
        // Apply remote update to local Y.Doc with REDIS_ORIGIN
        Y.applyUpdate(this.doc, remoteDocUpdate, REDIS_ORIGIN);
      },
      (remoteAwarenessUpdate) => {
        // Apply remote awareness to local awareness with REDIS_ORIGIN
        awarenessProtocol.applyAwarenessUpdate(this.awareness, remoteAwarenessUpdate, REDIS_ORIGIN);
      }
    );
  }

  /**
   * Register a new client connection in this room
   */
  public addConnection(conn: WebSocket) {
    this.conns.set(conn, new Set());
    this.lastActive = Date.now();

    // 1. Send Sync Step 1 to new client
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.doc);
    this.sendSafe(conn, encoding.toUint8Array(encoder));

    // 2. Send current awareness states to new client
    const awarenessStates = this.awareness.getStates();
    if (awarenessStates.size > 0) {
      const awarenessEncoder = encoding.createEncoder();
      encoding.writeVarUint(awarenessEncoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        awarenessEncoder,
        awarenessProtocol.encodeAwarenessUpdate(
          this.awareness,
          Array.from(awarenessStates.keys())
        )
      );
      this.sendSafe(conn, encoding.toUint8Array(awarenessEncoder));
    }

    // Handle incoming binary messages from this WebSocket client
    conn.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
      this.handleClientMessage(conn, new Uint8Array(data as any));
    });

    conn.on('close', () => {
      this.removeConnection(conn);
    });

    conn.on('error', () => {
      this.removeConnection(conn);
    });
  }

  /**
   * Handle incoming binary protocol messages
   */
  private handleClientMessage(conn: WebSocket, data: Uint8Array) {
    try {
      this.lastActive = Date.now();
      const decoder = decoding.createDecoder(data);
      const messageType = decoding.readVarUint(decoder);

      switch (messageType) {
        case MESSAGE_SYNC: {
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, MESSAGE_SYNC);
          syncProtocol.readSyncMessage(decoder, encoder, this.doc, conn);

          // If a response was generated, reply to the client
          if (encoding.length(encoder) > 1) {
            this.sendSafe(conn, encoding.toUint8Array(encoder));
          }
          break;
        }

        case MESSAGE_AWARENESS: {
          const update = decoding.readVarUint8Array(decoder);
          awarenessProtocol.applyAwarenessUpdate(this.awareness, update, conn);
          break;
        }

        case MESSAGE_QUERY_AWARENESS: {
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
          encoding.writeVarUint8Array(
            encoder,
            awarenessProtocol.encodeAwarenessUpdate(
              this.awareness,
              Array.from(this.awareness.getStates().keys())
            )
          );
          this.sendSafe(conn, encoding.toUint8Array(encoder));
          break;
        }

        default:
          console.warn(`[SyncSketch Room ${this.roomId}] Unrecognized message type: ${messageType}`);
      }
    } catch (err: any) {
      console.error(`[SyncSketch Room ${this.roomId}] Message handling error:`, err);
    }
  }

  /**
   * Remove disconnected client
   */
  public removeConnection(conn: WebSocket) {
    const controlledClients = this.conns.get(conn);
    this.conns.delete(conn);

    if (controlledClients && controlledClients.size > 0) {
      awarenessProtocol.removeAwarenessStates(
        this.awareness,
        Array.from(controlledClients),
        null
      );
    }
  }

  private sendSafe(conn: WebSocket, message: Uint8Array) {
    if (conn.readyState === WebSocket.OPEN) {
      try {
        conn.send(message, { binary: true });
      } catch (err) {
        this.removeConnection(conn);
      }
    }
  }

  public getConnectionCount(): number {
    return this.conns.size;
  }

  public getSnapshotVersion(): number {
    return this.lastSnapshotVersion;
  }

  public async destroy() {
    // Flush final snapshot if unpersisted mutations exist
    if (this.snapshotTimer) {
      clearTimeout(this.snapshotTimer);
      this.snapshotTimer = null;
    }

    if (this.mutationCounter > 0) {
      await this.triggerSnapshot('room_destroy_flush');
    }

    this.redisAdapter.unsubscribeRoom(this.roomId);
    this.conns.forEach((_, conn) => {
      try {
        conn.close();
      } catch {}
    });
    this.conns.clear();
    this.awareness.destroy();
    this.doc.destroy();
  }
}
