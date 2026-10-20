import Redis from 'ioredis';

export interface RedisPubSubConfig {
  url?: string;
  enabled?: boolean;
}

export class RedisPubSubAdapter {
  private pubClient: Redis | null = null;
  private subClient: Redis | null = null;
  private isConnected: boolean = false;
  private roomCallbacks: Map<
    string,
    {
      onDocUpdate: (update: Uint8Array) => void;
      onAwarenessUpdate: (update: Uint8Array) => void;
    }
  > = new Map();

  constructor(config: RedisPubSubConfig = {}) {
    const redisUrl = config.url || process.env.REDIS_URL || 'redis://127.0.0.1:6379';
    const enabled = config.enabled ?? (process.env.ENABLE_REDIS !== 'false');

    if (!enabled) {
      console.log('[SyncSketch Redis] Redis pub/sub disabled by configuration. Running in standalone mode.');
      return;
    }

    this.initClients(redisUrl);
  }

  private initClients(url: string) {
    try {
      const options = {
        maxRetriesPerRequest: 1,
        retryStrategy: (times: number) => {
          if (times > 10) {
            return null; // Stop retrying after 10 attempts
          }
          return Math.min(times * 1000, 5000); // Backoff up to 5s
        },
        lazyConnect: false,
        enableOfflineQueue: false,
      };

      this.pubClient = new Redis(url, options);
      this.subClient = new Redis(url, options);

      this.pubClient.on('connect', () => {
        this.isConnected = true;
        console.log('[SyncSketch Redis] 🚀 Publisher connected successfully to', url);
      });

      this.subClient.on('connect', () => {
        console.log('[SyncSketch Redis] 🚀 Subscriber connected successfully to', url);
      });

      let hasWarned = false;
      this.pubClient.on('error', (err) => {
        this.isConnected = false;
        // Graceful error logging without crashing Node process
        if (err.message.includes('ECONNREFUSED')) {
          if (!hasWarned) {
            hasWarned = true;
            console.warn('[SyncSketch Redis] ⚠️ Redis unreachable at ' + url + '. Operating in standalone in-memory mode.');
          }
        } else {
          console.warn('[SyncSketch Redis] Publisher error:', err.message);
        }
      });

      this.subClient.on('error', (err) => {
        if (!err.message.includes('ECONNREFUSED')) {
          console.warn('[SyncSketch Redis] Subscriber error:', err.message);
        }
      });

      // Handle incoming messages on subscribed Redis channels
      this.subClient.on('messageBuffer', (channelBuffer: Buffer, messageBuffer: Buffer) => {
        const channel = channelBuffer.toString('utf-8');
        const update = new Uint8Array(messageBuffer);

        if (channel.startsWith('syncsketch:doc:')) {
          const roomId = channel.replace('syncsketch:doc:', '');
          const callbacks = this.roomCallbacks.get(roomId);
          if (callbacks) {
            callbacks.onDocUpdate(update);
          }
        } else if (channel.startsWith('syncsketch:awareness:')) {
          const roomId = channel.replace('syncsketch:awareness:', '');
          const callbacks = this.roomCallbacks.get(roomId);
          if (callbacks) {
            callbacks.onAwarenessUpdate(update);
          }
        }
      });
    } catch (e: any) {
      console.warn('[SyncSketch Redis] Failed to initialize Redis adapter:', e.message);
      this.isConnected = false;
    }
  }

  public getIsConnected(): boolean {
    return this.isConnected;
  }

  /**
   * Subscribe to document updates and awareness broadcasts for a room
   */
  public async subscribeRoom(
    roomId: string,
    onDocUpdate: (update: Uint8Array) => void,
    onAwarenessUpdate: (update: Uint8Array) => void
  ) {
    this.roomCallbacks.set(roomId, { onDocUpdate, onAwarenessUpdate });

    if (this.subClient && this.isConnected) {
      try {
        await this.subClient.subscribe(
          `syncsketch:doc:${roomId}`,
          `syncsketch:awareness:${roomId}`
        );
      } catch (err: any) {
        console.warn(`[SyncSketch Redis] Could not subscribe to room ${roomId}:`, err.message);
      }
    }
  }

  /**
   * Unsubscribe from room channels
   */
  public async unsubscribeRoom(roomId: string) {
    this.roomCallbacks.delete(roomId);
    if (this.subClient && this.isConnected) {
      try {
        await this.subClient.unsubscribe(
          `syncsketch:doc:${roomId}`,
          `syncsketch:awareness:${roomId}`
        );
      } catch (err: any) {
        console.warn(`[SyncSketch Redis] Could not unsubscribe from room ${roomId}:`, err.message);
      }
    }
  }

  /**
   * Publish document binary update to other server instances
   */
  public async publishDocUpdate(roomId: string, update: Uint8Array) {
    if (!this.pubClient || !this.isConnected) return;
    try {
      const buffer = Buffer.from(update.buffer, update.byteOffset, update.byteLength);
      await this.pubClient.publish(`syncsketch:doc:${roomId}`, buffer);
    } catch (err: any) {
      // Ignore or log debug
    }
  }

  /**
   * Publish awareness binary update to other server instances
   */
  public async publishAwarenessUpdate(roomId: string, update: Uint8Array) {
    if (!this.pubClient || !this.isConnected) return;
    try {
      const buffer = Buffer.from(update.buffer, update.byteOffset, update.byteLength);
      await this.pubClient.publish(`syncsketch:awareness:${roomId}`, buffer);
    } catch (err: any) {
      // Ignore
    }
  }

  public async close() {
    if (this.pubClient) {
      try {
        this.pubClient.disconnect();
      } catch {}
    }
    if (this.subClient) {
      try {
        this.subClient.disconnect();
      } catch {}
    }
    this.roomCallbacks.clear();
  }
}
