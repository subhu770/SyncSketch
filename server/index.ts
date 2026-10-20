import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { RedisPubSubAdapter } from './redis';
import { CollabRoom } from './room';
import { dbManager } from './db';

const PORT = parseInt(process.env.PORT || '1234', 10);
const HOST = process.env.HOST || '0.0.0.0';

// Global state
const redisAdapter = new RedisPubSubAdapter();
const rooms: Map<string, CollabRoom> = new Map();
const roomInitPromises: Map<string, Promise<CollabRoom>> = new Map();

/**
 * Fetch or initialize CollabRoom with automated cold-storage restore from PostgreSQL
 */
async function getOrCreateRoom(roomId: string): Promise<CollabRoom> {
  const existingRoom = rooms.get(roomId);
  if (existingRoom) {
    return existingRoom;
  }

  // Mutex-like promise caching to prevent race conditions during cold start
  let initPromise = roomInitPromises.get(roomId);
  if (!initPromise) {
    initPromise = CollabRoom.create(roomId, redisAdapter)
      .then((createdRoom) => {
        rooms.set(roomId, createdRoom);
        roomInitPromises.delete(roomId);
        return createdRoom;
      })
      .catch((err) => {
        roomInitPromises.delete(roomId);
        throw err;
      });

    roomInitPromises.set(roomId, initPromise);
  }

  return initPromise;
}

// HTTP Server for Health Checks & WebSocket Upgrade
const server = http.createServer((req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = req.url || '/';

  if (url === '/health' || url === '/') {
    let totalConnections = 0;
    const roomSummaries: Record<string, { connections: number; snapshotVersion: number }> = {};

    rooms.forEach((room, id) => {
      totalConnections += room.getConnectionCount();
      roomSummaries[id] = {
        connections: room.getConnectionCount(),
        snapshotVersion: room.getSnapshotVersion(),
      };
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify(
        {
          status: 'ok',
          service: 'syncsketch-y-websocket',
          port: PORT,
          activeRooms: rooms.size,
          totalConnections,
          redisCluster: redisAdapter.getIsConnected() ? 'connected' : 'standalone-fallback',
          postgresStorage: dbManager.getIsPostgresConnected() ? 'connected' : 'disk-fallback',
          roomSummaries,
          uptime: process.uptime(),
          timestamp: new Date().toISOString(),
        },
        null,
        2
      )
    );
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

// WebSocket Server (No Server Mode, handled manually via upgrade event)
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', async (req, socket, head) => {
  const urlString = req.url || '';
  const parsedUrl = new URL(urlString, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // Dynamic Room Routing: /collaboration/:roomId
  const match = pathname.match(/^\/collaboration\/([a-zA-Z0-9_\-\.]+)/);
  const fallbackMatch = !match ? pathname.match(/^\/([a-zA-Z0-9_\-\.]+)/) : null;

  let targetRoomId: string | null = null;
  if (match && match[1]) {
    targetRoomId = match[1];
  } else if (fallbackMatch && fallbackMatch[1] && fallbackMatch[1] !== 'health') {
    targetRoomId = fallbackMatch[1];
  }

  if (targetRoomId) {
    const roomId = targetRoomId;
    try {
      // Restore binary snapshot from PostgreSQL BEFORE accepting WebSocket connections
      const room = await getOrCreateRoom(roomId);

      wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
        room.addConnection(ws);
        console.log(
          `[SyncSketch WS] Client connected to room "${roomId}" (Total peers: ${room.getConnectionCount()})`
        );

        ws.on('close', () => {
          console.log(
            `[SyncSketch WS] Client disconnected from room "${roomId}" (Remaining: ${room.getConnectionCount()})`
          );
        });
      });
      return;
    } catch (err: any) {
      console.error(`[SyncSketch Server] Failed to initialize room "${roomId}":`, err);
      socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
      socket.destroy();
      return;
    }
  }

  // Reject unrecognized path
  socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
  socket.destroy();
});

// Start listening
server.listen(PORT, HOST, () => {
  console.log('----------------------------------------------------');
  console.log(`✨ SyncSketch y-websocket Server is running!`);
  console.log(`📡 WebSocket URL: ws://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}/collaboration/:roomId`);
  console.log(`🩺 Health check: http://localhost:${PORT}/health`);
  console.log(`⚡ Redis Pub/Sub: ${redisAdapter.getIsConnected() ? 'Online' : 'Standalone (In-Memory Fallback)'}`);
  console.log(`💾 Cold Storage: ${dbManager.getIsPostgresConnected() ? 'PostgreSQL (Prisma)' : 'Resilient Disk / Fallback'}`);
  console.log('----------------------------------------------------');
});

// Graceful Cleanup
const cleanup = async () => {
  console.log('\n[SyncSketch Server] Shutting down gracefully...');
  for (const [, room] of rooms) {
    await room.destroy();
  }
  rooms.clear();
  await redisAdapter.close();
  await dbManager.close();
  wss.close();
  server.close(() => {
    console.log('[SyncSketch Server] Server closed cleanly.');
    process.exit(0);
  });
};

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
