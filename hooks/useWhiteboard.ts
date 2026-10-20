'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CanvasElement,
  ConnectionStatus,
  InterpolatedCursor,
  Point,
  StrokeStyle,
  ToolType,
  TransportType,
  UserIdentity,
  ViewTransform,
} from '../lib/crdt/types';
import { WhiteboardDocManager } from '../lib/crdt/yjs';
import { AwarenessManager } from '../lib/crdt/awareness';
import { createWhiteboardProvider, WhiteboardConnection } from '../lib/crdt/provider';
import { getCombinedBoundingBox } from '../lib/canvas/math';

export interface StyleOptions {
  strokeColor: string;
  fillColor: string;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
  opacity: number;
}

export function useWhiteboard(roomName: string = 'syncsketch-main') {
  // CRDT & Connection Managers
  const docManagerRef = useRef<WhiteboardDocManager | null>(null);
  const connectionRef = useRef<WhiteboardConnection | null>(null);
  const awarenessManagerRef = useRef<AwarenessManager | null>(null);

  // Reactive state
  const [elementsMap, setElementsMap] = useState<Map<string, CanvasElement>>(new Map());
  const [elementOrder, setElementOrder] = useState<string[]>([]);
  const [activeTool, setActiveTool] = useState<ToolType>('select');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [remoteUsers, setRemoteUsers] = useState<InterpolatedCursor[]>([]);
  const [canUndo, setCanUndo] = useState<boolean>(false);
  const [canRedo, setCanRedo] = useState<boolean>(false);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [transportType, setTransportType] = useState<TransportType>('websocket');
  const [isStorageSynced, setIsStorageSynced] = useState<boolean>(false);
  const [tombstonesCount, setTombstonesCount] = useState<number>(0);
  const [pendingMutations, setPendingMutations] = useState<number>(0);
  const [localUser, setLocalUser] = useState<UserIdentity>({
    name: 'Collaborator',
    color: '#00DF8F',
  });

  // Current active style defaults
  const [currentStyle, setCurrentStyle] = useState<StyleOptions>({
    strokeColor: '#f8fafc',
    fillColor: 'transparent',
    strokeWidth: 2,
    strokeStyle: 'solid',
    opacity: 1,
  });

  // Viewport camera transform
  const [viewTransform, setViewTransform] = useState<ViewTransform>({
    panX: 0,
    panY: 0,
    zoom: 1,
  });

  // Initialize Y.Doc, Provider, and Awareness on client mount
  useEffect(() => {
    const docManager = new WhiteboardDocManager();
    docManagerRef.current = docManager;

    const connection = createWhiteboardProvider(roomName, docManager.doc);
    connectionRef.current = connection;

    const awarenessManager = new AwarenessManager(connection.awareness);
    awarenessManagerRef.current = awarenessManager;
    setLocalUser(awarenessManager.getLocalUser());

    // Subscribe to CRDT elements mutations
    const unsubElements = docManager.subscribe((elements, order) => {
      setElementsMap(new Map(elements));
      setElementOrder([...order]);
      setCanUndo(docManager.canUndo());
      setCanRedo(docManager.canRedo());
    });

    // Subscribe to smooth interpolated cursors
    const unsubAwareness = awarenessManager.subscribe((cursors) => {
      setRemoteUsers(cursors);
    });

    // Track dynamic distributed provider connection status
    const unsubStatus = connection.onStatusChange((status, transport) => {
      setConnectionStatus(status);
      setTransportType(transport);
      setIsConnected(status === 'connected');
    });

    // Poll telemetry metrics (tombstones, mutations, storage sync)
    const telemetryInterval = setInterval(() => {
      if (docManagerRef.current) {
        setTombstonesCount(docManagerRef.current.getTombstonesCount());
        setPendingMutations(docManagerRef.current.getPendingMutationsCount());
      }
      if (connectionRef.current) {
        setIsStorageSynced(connectionRef.current.isStorageSynced());
      }
    }, 500);

    return () => {
      clearInterval(telemetryInterval);
      unsubStatus();
      unsubElements();
      unsubAwareness();
      awarenessManager.destroy();
      connection.destroy();
      docManager.destroy();
    };
  }, [roomName]);

  // Sorted list of elements according to elementOrder
  const elements = useMemo(() => {
    const list: CanvasElement[] = [];
    elementOrder.forEach((id) => {
      const el = elementsMap.get(id);
      if (el) list.push(el);
    });
    // Fallback if any elements missing in order array
    elementsMap.forEach((el, id) => {
      if (!elementOrder.includes(id)) {
        list.push(el);
      }
    });
    return list;
  }, [elementsMap, elementOrder]);

  // Elements currently selected
  const selectedElements = useMemo(() => {
    return selectedIds
      .map((id) => elementsMap.get(id))
      .filter((el): el is CanvasElement => el !== undefined);
  }, [elementsMap, selectedIds]);

  /**
   * Commit a newly created element to shared Yjs Doc (zero input lag, direct emission)
   */
  const commitElement = useCallback((element: CanvasElement) => {
    if (!docManagerRef.current) return;
    docManagerRef.current.setElement(element);
    setCanUndo(docManagerRef.current.canUndo());
    setCanRedo(docManagerRef.current.canRedo());
  }, []);

  /**
   * Update an existing element in Yjs Doc
   */
  const updateElement = useCallback((id: string, updates: Partial<CanvasElement>) => {
    if (!docManagerRef.current) return;
    const existing = elementsMap.get(id);
    if (!existing) return;
    const updated = { ...existing, ...updates, updatedAt: Date.now() } as CanvasElement;
    docManagerRef.current.setElement(updated);
  }, [elementsMap]);

  /**
   * Batch update multiple elements in Yjs Doc
   */
  const updateElements = useCallback((elementsToUpdate: CanvasElement[]) => {
    if (!docManagerRef.current) return;
    docManagerRef.current.setElements(elementsToUpdate);
  }, []);

  /**
   * Delete selected elements
   */
  const deleteSelected = useCallback(() => {
    if (!docManagerRef.current || selectedIds.length === 0) return;
    docManagerRef.current.deleteElements(selectedIds);
    setSelectedIds([]);
  }, [selectedIds]);

  /**
   * Clear entire canvas
   */
  const clearCanvas = useCallback(() => {
    if (!docManagerRef.current) return;
    docManagerRef.current.clearAll();
    setSelectedIds([]);
  }, []);

  /**
   * Undo/Redo actions
   */
  const undo = useCallback(() => {
    if (!docManagerRef.current) return;
    docManagerRef.current.undo();
    setCanUndo(docManagerRef.current.canUndo());
    setCanRedo(docManagerRef.current.canRedo());
  }, []);

  const redo = useCallback(() => {
    if (!docManagerRef.current) return;
    docManagerRef.current.redo();
    setCanUndo(docManagerRef.current.canUndo());
    setCanRedo(docManagerRef.current.canRedo());
  }, []);

  /**
   * Broadcast local cursor & drawing activity via Yjs Awareness
   */
  const broadcastCursor = useCallback((pos: Point | null, isDrawing: boolean = false) => {
    if (!awarenessManagerRef.current) return;
    awarenessManagerRef.current.setLocalCursor(pos, isDrawing, activeTool, selectedIds);
  }, [activeTool, selectedIds]);

  /**
   * Update local user name
   */
  const updateUserName = useCallback((name: string) => {
    if (!awarenessManagerRef.current) return;
    awarenessManagerRef.current.setLocalUserName(name);
    setLocalUser(awarenessManagerRef.current.getLocalUser());
  }, []);

  /**
   * Change styling for active tool and any currently selected elements
   */
  const setStyle = useCallback((updates: Partial<StyleOptions>) => {
    setCurrentStyle((prev) => {
      const next = { ...prev, ...updates };

      // Apply to selected elements optimistically
      if (selectedIds.length > 0 && docManagerRef.current) {
        const batch: CanvasElement[] = [];
        selectedIds.forEach((id) => {
          const el = elementsMap.get(id);
          if (el) {
            batch.push({
              ...el,
              ...updates,
              updatedAt: Date.now(),
            } as CanvasElement);
          }
        });
        if (batch.length > 0) {
          docManagerRef.current.setElements(batch);
        }
      }

      return next;
    });
  }, [selectedIds, elementsMap]);

  /**
   * Reorder Z-index of selected element
   */
  const reorderSelected = useCallback((action: 'front' | 'back' | 'forward' | 'backward') => {
    if (!docManagerRef.current || selectedIds.length === 0) return;
    selectedIds.forEach((id) => {
      docManagerRef.current?.moveElementZIndex(id, action);
    });
  }, [selectedIds]);

  /**
   * Camera controls
   */
  const setPan = useCallback((panX: number, panY: number) => {
    setViewTransform((prev) => ({ ...prev, panX, panY }));
  }, []);

  const setZoom = useCallback((newZoom: number, centerPoint?: Point) => {
    const clampedZoom = Math.max(0.1, Math.min(5, newZoom));
    setViewTransform((prev) => {
      if (!centerPoint) {
        return { ...prev, zoom: clampedZoom };
      }
      // Zoom centered at mouse coordinate
      const zoomFactor = clampedZoom / prev.zoom;
      return {
        zoom: clampedZoom,
        panX: centerPoint.x - (centerPoint.x - prev.panX) * zoomFactor,
        panY: centerPoint.y - (centerPoint.y - prev.panY) * zoomFactor,
      };
    });
  }, []);

  const zoomIn = useCallback(() => {
    setViewTransform((prev) => ({
      ...prev,
      zoom: Math.min(5, Math.round((prev.zoom + 0.15) * 100) / 100),
    }));
  }, []);

  const zoomOut = useCallback(() => {
    setViewTransform((prev) => ({
      ...prev,
      zoom: Math.max(0.1, Math.round((prev.zoom - 0.15) * 100) / 100),
    }));
  }, []);

  const resetZoom = useCallback(() => {
    setViewTransform({ panX: 0, panY: 0, zoom: 1 });
  }, []);

  const fitToContent = useCallback((viewportWidth: number, viewportHeight: number) => {
    if (elements.length === 0) {
      resetZoom();
      return;
    }
    const box = getCombinedBoundingBox(elements);
    if (!box) return;

    const padding = 80;
    const scaleX = (viewportWidth - padding * 2) / box.width;
    const scaleY = (viewportHeight - padding * 2) / box.height;
    const fitZoom = Math.max(0.2, Math.min(2, Math.min(scaleX, scaleY)));

    const panX = viewportWidth / 2 - (box.x + box.width / 2) * fitZoom;
    const panY = viewportHeight / 2 - (box.y + box.height / 2) * fitZoom;

    setViewTransform({ panX, panY, zoom: fitZoom });
  }, [elements, resetZoom]);

  return {
    elements,
    elementsMap,
    elementOrder,
    activeTool,
    setActiveTool,
    selectedIds,
    setSelectedIds,
    selectedElements,
    currentStyle,
    setStyle,
    viewTransform,
    setViewTransform,
    setPan,
    setZoom,
    zoomIn,
    zoomOut,
    resetZoom,
    fitToContent,
    commitElement,
    updateElement,
    updateElements,
    deleteSelected,
    clearCanvas,
    undo,
    redo,
    canUndo,
    canRedo,
    reorderSelected,
    remoteUsers,
    broadcastCursor,
    localUser,
    updateUserName,
    isConnected,
    connectionStatus,
    transportType,
    isStorageSynced,
    tombstonesCount,
    pendingMutations,
    roomName,
  };
}
