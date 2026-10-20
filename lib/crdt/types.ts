/**
 * SyncSketch CRDT & Canvas Type Definitions
 * Represents all shared canvas primitives, awareness states, and event payloads.
 */

export type ToolType =
  | 'select'
  | 'pan'
  | 'rectangle'
  | 'ellipse'
  | 'diamond'
  | 'arrow'
  | 'line'
  | 'freehand'
  | 'text'
  | 'eraser';

export type ConnectionStatus = 'connected' | 'connecting' | 'reconnecting' | 'offline';
export type TransportType = 'websocket' | 'webrtc';

export type StrokeStyle = 'solid' | 'dashed' | 'dotted';

export interface Point {
  x: number;
  y: number;
  pressure?: number;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BaseElement {
  id: string;
  type: ToolType;
  x: number;
  y: number;
  width: number;
  height: number;
  strokeColor: string;
  fillColor: string;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
  opacity: number;
  roughness?: number;
  rotation?: number;
  zIndex: number;
  fractionalIndex: string;
  deletedAt?: number;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface ElementTombstone {
  id: string;
  deletedAt: number;
  deletedBy: string;
}

export interface PerformanceMetrics {
  fps: number;
  peerCount: number;
  pendingMutations: number;
  pingLatencyMs: number;
  totalElements: number;
  tombstonesCount: number;
  storageSynced: boolean;
}

export interface RectElement extends BaseElement {
  type: 'rectangle';
  cornerRadius?: number;
}

export interface EllipseElement extends BaseElement {
  type: 'ellipse';
}

export interface DiamondElement extends BaseElement {
  type: 'diamond';
}

export interface ArrowElement extends BaseElement {
  type: 'arrow';
  points: Point[];
  arrowStart?: boolean;
  arrowEnd?: boolean;
}

export interface LineElement extends BaseElement {
  type: 'line';
  points: Point[];
}

export interface FreehandElement extends BaseElement {
  type: 'freehand';
  points: Point[];
  simulatePressure?: boolean;
}

export interface TextElement extends BaseElement {
  type: 'text';
  text: string;
  fontSize: number;
  fontFamily: string;
  textAlign: 'left' | 'center' | 'right';
  lineHeight?: number;
}

export type CanvasElement =
  | RectElement
  | EllipseElement
  | DiamondElement
  | ArrowElement
  | LineElement
  | FreehandElement
  | TextElement;

export type ElementUpdate = Partial<CanvasElement> & { id: string };

/**
 * Live User Awareness State
 * Broadcasted via Yjs Awareness Protocol
 */
export interface UserIdentity {
  name: string;
  color: string;
  avatarSeed?: string;
}

export interface UserAwarenessState {
  user: UserIdentity;
  cursor: {
    x: number;
    y: number;
  } | null;
  selectedElementIds: string[];
  isDrawing: boolean;
  activeTool: ToolType;
  lastActive: number;
}

/**
 * Client-side smoothed remote collaborator cursor
 */
export interface InterpolatedCursor {
  clientId: number;
  name: string;
  color: string;
  currentX: number;
  currentY: number;
  targetX: number;
  targetY: number;
  isDrawing: boolean;
  activeTool: ToolType;
  selectedElementIds: string[];
  lastSeen: number;
}

/**
 * Viewport Camera Transform
 */
export interface ViewTransform {
  panX: number;
  panY: number;
  zoom: number;
}

/**
 * Transform Handle for resizing elements
 */
export type ResizeHandle = 'tl' | 'tr' | 'bl' | 'br' | 'tm' | 'bm' | 'ml' | 'mr' | 'rotate';

export interface HandlePosition {
  handle: ResizeHandle;
  x: number;
  y: number;
}
