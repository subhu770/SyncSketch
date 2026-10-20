import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';

export interface SnapshotMetadata {
  id: string;
  roomId: string;
  version: number;
  elementCount: number;
  sizeBytes: number;
  createdAt: string;
  storage: 'postgres' | 'filesystem';
}

export interface RestoredSnapshot {
  snapshotBytes: Uint8Array;
  version: number;
  elementCount: number;
  storage: 'postgres' | 'filesystem';
}

class DatabaseManager {
  private prisma: PrismaClient | null = null;
  private isPostgresConnected: boolean = false;
  private diskStorageDir: string;

  constructor() {
    this.diskStorageDir = path.resolve(process.cwd(), 'server', 'storage', 'snapshots');
    this.ensureDiskStorage();
    this.initPrisma();
  }

  private ensureDiskStorage() {
    try {
      if (!fs.existsSync(this.diskStorageDir)) {
        fs.mkdirSync(this.diskStorageDir, { recursive: true });
      }
    } catch (err) {
      console.error('[SyncSketch DB] Failed to create disk storage directory:', err);
    }
  }

  private async initPrisma() {
    try {
      this.prisma = new PrismaClient({
        log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
      });

      // Quick connection verification with timeout
      await this.prisma.$connect();
      this.isPostgresConnected = true;
      console.log('✅ [SyncSketch DB] PostgreSQL cold-storage connected via Prisma');
    } catch (err: any) {
      this.isPostgresConnected = false;
      console.warn(
        `⚠️  [SyncSketch DB] PostgreSQL offline (${err?.message || 'Connection refused'}). Operating with resilient disk snapshot fallback at /server/storage/snapshots/`
      );
    }
  }

  public getIsPostgresConnected(): boolean {
    return this.isPostgresConnected;
  }

  /**
   * Persist a compressed binary room snapshot to PostgreSQL (or filesystem fallback)
   */
  public async saveSnapshot(
    roomName: string,
    uncompressedUpdate: Uint8Array,
    elementCount: number
  ): Promise<SnapshotMetadata> {
    // 1. Compress binary state update with Gzip
    const compressedBuffer = zlib.gzipSync(Buffer.from(uncompressedUpdate));

    // 2. Attempt PostgreSQL persistence via Prisma
    if (this.isPostgresConnected && this.prisma) {
      try {
        const room = await this.prisma.room.upsert({
          where: { name: roomName },
          update: { updatedAt: new Date() },
          create: { name: roomName },
        });

        const latestSnapshot = await this.prisma.roomSnapshot.findFirst({
          where: { roomId: room.id },
          orderBy: { createdAt: 'desc' },
          select: { version: true },
        });

        const nextVersion = (latestSnapshot?.version ?? 0) + 1;

        const snapshot = await this.prisma.roomSnapshot.create({
          data: {
            roomId: room.id,
            snapshotBlob: compressedBuffer,
            version: nextVersion,
            elementCount,
          },
        });

        // Write secondary mirror to disk for instant disaster recovery
        this.saveDiskMirror(roomName, compressedBuffer, nextVersion, elementCount);

        return {
          id: snapshot.id,
          roomId: room.id,
          version: nextVersion,
          elementCount,
          sizeBytes: compressedBuffer.length,
          createdAt: snapshot.createdAt.toISOString(),
          storage: 'postgres',
        };
      } catch (dbErr: any) {
        console.warn(
          `[SyncSketch DB] PostgreSQL snapshot write failed, falling back to disk:`,
          dbErr?.message || dbErr
        );
        this.isPostgresConnected = false;
      }
    }

    // 3. Fallback: Persist snapshot to local disk storage
    return this.saveDiskSnapshot(roomName, compressedBuffer, elementCount);
  }

  /**
   * Fetch the latest binary snapshot from PostgreSQL (or filesystem fallback)
   */
  public async getLatestSnapshot(roomName: string): Promise<RestoredSnapshot | null> {
    // 1. Query PostgreSQL via Prisma
    if (this.isPostgresConnected && this.prisma) {
      try {
        const room = await this.prisma.room.findUnique({
          where: { name: roomName },
          include: {
            snapshots: {
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
        });

        if (room && room.snapshots.length > 0) {
          const snapshot = room.snapshots[0];
          const decompressed = this.decompressBlob(snapshot.snapshotBlob);
          return {
            snapshotBytes: decompressed,
            version: snapshot.version,
            elementCount: snapshot.elementCount,
            storage: 'postgres',
          };
        }
      } catch (dbErr: any) {
        console.warn(
          `[SyncSketch DB] PostgreSQL read error for room "${roomName}", checking disk fallback:`,
          dbErr?.message || dbErr
        );
      }
    }

    // 2. Fallback: Query disk storage
    return this.getDiskSnapshot(roomName);
  }

  /**
   * Safe decompression helper (gzip or raw fallback)
   */
  private decompressBlob(blob: Buffer | Uint8Array): Uint8Array {
    const buf = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
    try {
      const decompressed = zlib.gunzipSync(buf);
      return new Uint8Array(decompressed);
    } catch {
      // In case the blob was stored raw / uncompressed
      return new Uint8Array(buf);
    }
  }

  /**
   * Filesystem snapshot storage fallback
   */
  private saveDiskSnapshot(
    roomName: string,
    compressedBuffer: Buffer,
    elementCount: number
  ): SnapshotMetadata {
    this.ensureDiskStorage();
    const binPath = path.join(this.diskStorageDir, `${roomName}.bin`);
    const metaPath = path.join(this.diskStorageDir, `${roomName}.meta.json`);

    let prevVersion = 0;
    try {
      if (fs.existsSync(metaPath)) {
        const prevMeta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        prevVersion = prevMeta.version || 0;
      }
    } catch {}

    const version = prevVersion + 1;
    const nowIso = new Date().toISOString();

    fs.writeFileSync(binPath, compressedBuffer);
    const meta: SnapshotMetadata = {
      id: `disk-${Date.now()}`,
      roomId: roomName,
      version,
      elementCount,
      sizeBytes: compressedBuffer.length,
      createdAt: nowIso,
      storage: 'filesystem',
    };
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');

    return meta;
  }

  private saveDiskMirror(roomName: string, buffer: Buffer, version: number, elementCount: number) {
    try {
      this.ensureDiskStorage();
      const binPath = path.join(this.diskStorageDir, `${roomName}.bin`);
      const metaPath = path.join(this.diskStorageDir, `${roomName}.meta.json`);
      fs.writeFileSync(binPath, buffer);
      fs.writeFileSync(
        metaPath,
        JSON.stringify(
          {
            roomId: roomName,
            version,
            elementCount,
            sizeBytes: buffer.length,
            updatedAt: new Date().toISOString(),
          },
          null,
          2
        )
      );
    } catch {}
  }

  private getDiskSnapshot(roomName: string): RestoredSnapshot | null {
    try {
      const binPath = path.join(this.diskStorageDir, `${roomName}.bin`);
      const metaPath = path.join(this.diskStorageDir, `${roomName}.meta.json`);

      if (!fs.existsSync(binPath)) {
        return null;
      }

      const compressedBuf = fs.readFileSync(binPath);
      const decompressed = this.decompressBlob(compressedBuf);

      let version = 1;
      let elementCount = 0;
      if (fs.existsSync(metaPath)) {
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
          version = meta.version || 1;
          elementCount = meta.elementCount || 0;
        } catch {}
      }

      return {
        snapshotBytes: decompressed,
        version,
        elementCount,
        storage: 'filesystem',
      };
    } catch (err) {
      console.error(`[SyncSketch DB] Error reading disk snapshot for room "${roomName}":`, err);
      return null;
    }
  }

  public async close() {
    if (this.prisma) {
      await this.prisma.$disconnect();
    }
  }
}

export const dbManager = new DatabaseManager();
