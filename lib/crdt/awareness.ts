import { Awareness } from 'y-protocols/awareness';
import { InterpolatedCursor, ToolType, UserAwarenessState, UserIdentity } from './types';

const VIBRANT_COLORS = [
  '#FF2E93', // Neon Fuchsia
  '#7928CA', // Electric Purple
  '#0070F3', // Cobalt Blue
  '#00DF8F', // Neon Mint
  '#F5A623', // Vibrant Amber
  '#FF4F00', // International Orange
  '#00D8F6', // Cyber Cyan
  '#9B51E0', // Deep Violet
  '#10B981', // Emerald
  '#F43F5E', // Rose
];

const COLLABORATOR_NAMES = [
  'Aura Lynx',
  'Neon Falcon',
  'Cyber Fox',
  'Solar Finch',
  'Quantum Otter',
  'Echo Osprey',
  'Vivid Panther',
  'Zenith Heron',
  'Drift Wolf',
  'Prism Kestrel',
];

export function getRandomUserIdentity(): UserIdentity {
  const color = VIBRANT_COLORS[Math.floor(Math.random() * VIBRANT_COLORS.length)];
  const name = COLLABORATOR_NAMES[Math.floor(Math.random() * COLLABORATOR_NAMES.length)];
  return {
    name,
    color,
    avatarSeed: Math.random().toString(36).substring(2, 9),
  };
}

export class AwarenessManager {
  private awareness: Awareness;
  private localUser: UserIdentity;
  private remoteCursors: Map<number, InterpolatedCursor> = new Map();
  private subscribers: Set<(cursors: InterpolatedCursor[]) => void> = new Set();
  private animFrameId: number | null = null;
  private isRunning: boolean = false;

  constructor(awareness: Awareness, initialIdentity?: UserIdentity) {
    this.awareness = awareness;
    this.localUser = initialIdentity || getRandomUserIdentity();

    // Set initial local state in awareness
    this.setLocalState({
      user: this.localUser,
      cursor: null,
      selectedElementIds: [],
      isDrawing: false,
      activeTool: 'select',
      lastActive: Date.now(),
    });

    this.setupListeners();
    this.startInterpolationLoop();
  }

  public getLocalUser(): UserIdentity {
    return this.localUser;
  }

  public setLocalUserName(name: string) {
    this.localUser.name = name;
    this.updateLocalUserField({ name });
  }

  public setLocalUserColor(color: string) {
    this.localUser.color = color;
    this.updateLocalUserField({ color });
  }

  private updateLocalUserField(patch: Partial<UserIdentity>) {
    const current = this.awareness.getLocalState() as UserAwarenessState | null;
    if (current) {
      this.setLocalState({
        ...current,
        user: { ...current.user, ...patch },
        lastActive: Date.now(),
      });
    }
  }

  public setLocalCursor(
    pos: { x: number; y: number } | null,
    isDrawing: boolean,
    activeTool: ToolType,
    selectedElementIds: string[]
  ) {
    const current = this.awareness.getLocalState() as UserAwarenessState | null;
    this.setLocalState({
      user: this.localUser,
      cursor: pos,
      isDrawing,
      activeTool,
      selectedElementIds,
      lastActive: Date.now(),
    });
  }

  private setLocalState(state: UserAwarenessState) {
    this.awareness.setLocalState(state as any);
  }

  private setupListeners() {
    this.awareness.on('change', () => {
      const states = this.awareness.getStates();
      const now = Date.now();

      // Update target positions for all remote users
      states.forEach((stateAny, clientId) => {
        if (clientId === this.awareness.clientID) return; // skip local
        const state = stateAny as UserAwarenessState | undefined;
        if (!state || !state.user) return;

        if (state.cursor) {
          const existing = this.remoteCursors.get(clientId);
          if (existing) {
            existing.targetX = state.cursor.x;
            existing.targetY = state.cursor.y;
            existing.isDrawing = state.isDrawing;
            existing.activeTool = state.activeTool;
            existing.selectedElementIds = state.selectedElementIds || [];
            existing.name = state.user.name;
            existing.color = state.user.color;
            existing.lastSeen = now;
          } else {
            // New collaborator cursor
            this.remoteCursors.set(clientId, {
              clientId,
              name: state.user.name,
              color: state.user.color,
              currentX: state.cursor.x,
              currentY: state.cursor.y,
              targetX: state.cursor.x,
              targetY: state.cursor.y,
              isDrawing: state.isDrawing,
              activeTool: state.activeTool,
              selectedElementIds: state.selectedElementIds || [],
              lastSeen: now,
            });
          }
        } else {
          // User cursor moved out of canvas or inactive
          this.remoteCursors.delete(clientId);
        }
      });

      // Cleanup disconnected clients
      for (const clientId of this.remoteCursors.keys()) {
        if (!states.has(clientId)) {
          this.remoteCursors.delete(clientId);
        }
      }
    });
  }

  /**
   * Continuous interpolation loop (runs at 60-120fps via requestAnimationFrame)
   * Lerps (x, y) coordinates smoothly to target to eliminate cursor jitter
   */
  private startInterpolationLoop() {
    this.isRunning = true;
    const LERP_FACTOR = 0.28; // Balance between fluidity and latency
    const SNAP_THRESHOLD = 0.25;

    const step = () => {
      if (!this.isRunning) return;

      let changed = false;
      const now = Date.now();

      this.remoteCursors.forEach((cursor, clientId) => {
        // Prune stale cursors after 20s of no updates
        if (now - cursor.lastSeen > 20000) {
          this.remoteCursors.delete(clientId);
          changed = true;
          return;
        }

        const dx = cursor.targetX - cursor.currentX;
        const dy = cursor.targetY - cursor.currentY;

        if (Math.abs(dx) > SNAP_THRESHOLD || Math.abs(dy) > SNAP_THRESHOLD) {
          cursor.currentX += dx * LERP_FACTOR;
          cursor.currentY += dy * LERP_FACTOR;
          changed = true;
        } else if (cursor.currentX !== cursor.targetX || cursor.currentY !== cursor.targetY) {
          cursor.currentX = cursor.targetX;
          cursor.currentY = cursor.targetY;
          changed = true;
        }
      });

      if (changed || this.remoteCursors.size > 0) {
        this.notifySubscribers();
      }

      this.animFrameId = requestAnimationFrame(step);
    };

    this.animFrameId = requestAnimationFrame(step);
  }

  public subscribe(callback: (cursors: InterpolatedCursor[]) => void): () => void {
    this.subscribers.add(callback);
    callback(Array.from(this.remoteCursors.values()));
    return () => {
      this.subscribers.delete(callback);
    };
  }

  private notifySubscribers() {
    const list = Array.from(this.remoteCursors.values());
    this.subscribers.forEach((cb) => cb(list));
  }

  public destroy() {
    this.isRunning = false;
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
    }
    this.subscribers.clear();
    this.remoteCursors.clear();
  }
}
