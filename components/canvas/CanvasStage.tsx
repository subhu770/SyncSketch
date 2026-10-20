'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  BoundingBox,
  CanvasElement,
  FreehandElement,
  Point,
  ResizeHandle,
  TextElement,
  ToolType,
  ViewTransform,
} from '../../lib/crdt/types';
import { StyleOptions } from '../../hooks/useWhiteboard';
import { CanvasRenderer } from '../../lib/canvas/renderer';
import {
  getCombinedBoundingBox,
  getElementBoundingBox,
  hitTestResizeHandle,
  isPointInsideElement,
  screenToWorld,
  worldToScreen,
} from '../../lib/canvas/math';

interface CanvasStageProps {
  elements: CanvasElement[];
  activeTool: ToolType;
  setActiveTool: (tool: ToolType) => void;
  selectedIds: string[];
  setSelectedIds: React.Dispatch<React.SetStateAction<string[]>>;
  currentStyle: StyleOptions;
  viewTransform: ViewTransform;
  setViewTransform: React.Dispatch<React.SetStateAction<ViewTransform>>;
  commitElement: (element: CanvasElement) => void;
  updateElements: (elements: CanvasElement[]) => void;
  deleteSelected: () => void;
  broadcastCursor: (pos: Point | null, isDrawing: boolean) => void;
}

interface InlineTextEditorState {
  id: string;
  worldX: number;
  worldY: number;
  text: string;
  fontSize: number;
  fontFamily: string;
  strokeColor: string;
}

export const CanvasStage: React.FC<CanvasStageProps> = ({
  elements,
  activeTool,
  setActiveTool,
  selectedIds,
  setSelectedIds,
  currentStyle,
  viewTransform,
  setViewTransform,
  commitElement,
  updateElements,
  deleteSelected,
  broadcastCursor,
}) => {
  // Canvases
  const containerRef = useRef<HTMLDivElement | null>(null);
  const gridCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const mainCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const scratchCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Active interaction tracking
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [textEditor, setTextEditor] = useState<InlineTextEditorState | null>(null);
  const textEditorRef = useRef<HTMLTextAreaElement | null>(null);

  // Interaction mutable refs for 120 FPS pointer handlers
  const interactionRef = useRef<{
    mode: 'none' | 'pan' | 'draw' | 'drag' | 'resize' | 'marquee' | 'erase';
    startScreenPoint: Point;
    startWorldPoint: Point;
    activeHandle: ResizeHandle | null;
    dragInitialElements: Map<string, CanvasElement>;
    draftElement: CanvasElement | null;
    marqueeBox: BoundingBox | null;
  }>({
    mode: 'none',
    startScreenPoint: { x: 0, y: 0 },
    startWorldPoint: { x: 0, y: 0 },
    activeHandle: null,
    dragInitialElements: new Map(),
    draftElement: null,
    marqueeBox: null,
  });

  /**
   * Resize and sync high-DPI canvas dimensions
   */
  const handleResize = useCallback(() => {
    if (!containerRef.current) return;
    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;
    const dpr = window.devicePixelRatio || 1;

    [gridCanvasRef.current, mainCanvasRef.current, scratchCanvasRef.current].forEach((cvs) => {
      if (cvs) {
        cvs.width = width * dpr;
        cvs.height = height * dpr;
        cvs.style.width = `${width}px`;
        cvs.style.height = `${height}px`;
        const ctx = cvs.getContext('2d');
        if (ctx) {
          ctx.setTransform(1, 0, 0, 1, 0, 0); // reset
          ctx.scale(dpr, dpr);
        }
      }
    });

    renderAll();
  }, [viewTransform, elements, selectedIds]);

  useEffect(() => {
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [handleResize]);

  /**
   * Full Canvas Render Pass (Grid + Committed Elements + Selection Box)
   */
  const renderAll = useCallback(() => {
    if (!containerRef.current) return;
    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    // 1. Render Grid Canvas
    if (gridCanvasRef.current) {
      const gridCtx = gridCanvasRef.current.getContext('2d');
      if (gridCtx) {
        CanvasRenderer.renderGrid(gridCtx, width, height, viewTransform, true);
      }
    }

    // 2. Render Main Elements Canvas
    if (mainCanvasRef.current) {
      const mainCtx = mainCanvasRef.current.getContext('2d');
      if (mainCtx) {
        mainCtx.clearRect(0, 0, width, height);
        mainCtx.save();
        // Apply camera transformation
        mainCtx.translate(viewTransform.panX, viewTransform.panY);
        mainCtx.scale(viewTransform.zoom, viewTransform.zoom);

        // Render all committed shared elements
        elements.forEach((el) => {
          CanvasRenderer.renderElement(mainCtx, el);
        });

        // Render active selection bounding box & handles
        const selectedEls = elements.filter((el) => selectedIds.includes(el.id));
        if (selectedEls.length > 0) {
          CanvasRenderer.renderSelectionBox(mainCtx, selectedEls, viewTransform.zoom);
        }

        mainCtx.restore();
      }
    }
  }, [elements, selectedIds, viewTransform]);

  useEffect(() => {
    renderAll();
  }, [renderAll]);

  /**
   * Pointer Down: Dispatch action based on active tool or hit-tested elements
   */
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const worldPoint = screenToWorld(screenX, screenY, viewTransform);

    // Commit any active text editor on canvas click
    if (textEditor) {
      commitTextEditor();
    }

    // Hand / Pan Tool or Middle Mouse Button or Spacebar held
    if (activeTool === 'pan' || e.button === 1 || isSpacePressed) {
      interactionRef.current = {
        mode: 'pan',
        startScreenPoint: { x: screenX, y: screenY },
        startWorldPoint: worldPoint,
        activeHandle: null,
        dragInitialElements: new Map(),
        draftElement: null,
        marqueeBox: null,
      };
      return;
    }

    // Eraser Tool: Click on elements to delete
    if (activeTool === 'eraser') {
      const clickedEl = [...elements].reverse().find((el) => isPointInsideElement(worldPoint, el));
      if (clickedEl) {
        updateElements([]); // triggers batch delete
        interactionRef.current.mode = 'erase';
      }
      return;
    }

    // Text Tool: Open inline text editor
    if (activeTool === 'text') {
      const newId = `txt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      setTextEditor({
        id: newId,
        worldX: worldPoint.x,
        worldY: worldPoint.y,
        text: '',
        fontSize: 20,
        fontFamily: 'Inter, sans-serif',
        strokeColor: currentStyle.strokeColor,
      });
      return;
    }

    // Select Tool: Resize handle hit, element drag hit, or marquee selection
    if (activeTool === 'select') {
      const selectedEls = elements.filter((el) => selectedIds.includes(el.id));
      if (selectedEls.length > 0) {
        const box = getCombinedBoundingBox(selectedEls);
        if (box) {
          const handle = hitTestResizeHandle(worldPoint, box, viewTransform.zoom);
          if (handle) {
            // Hit a transform handle! Begin resizing
            const initialMap = new Map<string, CanvasElement>();
            selectedEls.forEach((el) => initialMap.set(el.id, { ...el }));
            interactionRef.current = {
              mode: 'resize',
              startScreenPoint: { x: screenX, y: screenY },
              startWorldPoint: worldPoint,
              activeHandle: handle,
              dragInitialElements: initialMap,
              draftElement: null,
              marqueeBox: null,
            };
            return;
          }
        }
      }

      // Check if clicked an element
      const clickedEl = [...elements].reverse().find((el) => isPointInsideElement(worldPoint, el));
      if (clickedEl) {
        const isAlreadySelected = selectedIds.includes(clickedEl.id);
        const newSelectedIds = e.shiftKey
          ? isAlreadySelected
            ? selectedIds.filter((id) => id !== clickedEl.id)
            : [...selectedIds, clickedEl.id]
          : isAlreadySelected
          ? selectedIds
          : [clickedEl.id];

        setSelectedIds(newSelectedIds);

        // Prepare optimistic dragging
        const initialMap = new Map<string, CanvasElement>();
        elements
          .filter((el) => newSelectedIds.includes(el.id))
          .forEach((el) => initialMap.set(el.id, { ...el }));

        interactionRef.current = {
          mode: 'drag',
          startScreenPoint: { x: screenX, y: screenY },
          startWorldPoint: worldPoint,
          activeHandle: null,
          dragInitialElements: initialMap,
          draftElement: null,
          marqueeBox: null,
        };
        return;
      }

      // Hit empty canvas: Deselect & start Marquee Selection
      if (!e.shiftKey) {
        setSelectedIds([]);
      }
      interactionRef.current = {
        mode: 'marquee',
        startScreenPoint: { x: screenX, y: screenY },
        startWorldPoint: worldPoint,
        activeHandle: null,
        dragInitialElements: new Map(),
        draftElement: null,
        marqueeBox: { x: worldPoint.x, y: worldPoint.y, width: 0, height: 0 },
      };
      return;
    }

    // Geometric Shapes & Freehand Tool: Create Optimistic Draft Element
    const newId = `el_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    let initialElement: CanvasElement;

    if (activeTool === 'freehand') {
      initialElement = {
        id: newId,
        type: 'freehand',
        x: worldPoint.x,
        y: worldPoint.y,
        width: 0,
        height: 0,
        points: [{ x: worldPoint.x, y: worldPoint.y }],
        strokeColor: currentStyle.strokeColor,
        fillColor: 'transparent',
        strokeWidth: currentStyle.strokeWidth,
        strokeStyle: currentStyle.strokeStyle,
        opacity: currentStyle.opacity,
        zIndex: elements.length,
        fractionalIndex: '',
        createdBy: 'local',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      } as FreehandElement;
    } else if (activeTool === 'line' || activeTool === 'arrow') {
      initialElement = {
        id: newId,
        type: activeTool,
        x: worldPoint.x,
        y: worldPoint.y,
        width: 0,
        height: 0,
        points: [
          { x: worldPoint.x, y: worldPoint.y },
          { x: worldPoint.x, y: worldPoint.y },
        ],
        strokeColor: currentStyle.strokeColor,
        fillColor: 'transparent',
        strokeWidth: currentStyle.strokeWidth,
        strokeStyle: currentStyle.strokeStyle,
        opacity: currentStyle.opacity,
        zIndex: elements.length,
        fractionalIndex: '',
        createdBy: 'local',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      } as any;
    } else {
      // Rectangle, Ellipse, Diamond
      initialElement = {
        id: newId,
        type: activeTool,
        x: worldPoint.x,
        y: worldPoint.y,
        width: 0,
        height: 0,
        strokeColor: currentStyle.strokeColor,
        fillColor: currentStyle.fillColor,
        strokeWidth: currentStyle.strokeWidth,
        strokeStyle: currentStyle.strokeStyle,
        opacity: currentStyle.opacity,
        zIndex: elements.length,
        fractionalIndex: '',
        createdBy: 'local',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      } as any;
    }

    interactionRef.current = {
      mode: 'draw',
      startScreenPoint: { x: screenX, y: screenY },
      startWorldPoint: worldPoint,
      activeHandle: null,
      dragInitialElements: new Map(),
      draftElement: initialElement,
      marqueeBox: null,
    };
  };

  /**
   * Pointer Move: Zero input lag rendering on double-buffered scratch canvas
   */
  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const worldPoint = screenToWorld(screenX, screenY, viewTransform);

    // Broadcast cursor position to collaborators via Yjs Awareness
    broadcastCursor(worldPoint, interactionRef.current.mode === 'draw');

    const interaction = interactionRef.current;
    if (interaction.mode === 'none') return;

    // 1. Panning Mode
    if (interaction.mode === 'pan') {
      const dx = screenX - interaction.startScreenPoint.x;
      const dy = screenY - interaction.startScreenPoint.y;
      setViewTransform((prev) => ({
        ...prev,
        panX: prev.panX + dx,
        panY: prev.panY + dy,
      }));
      interaction.startScreenPoint = { x: screenX, y: screenY };
      return;
    }

    // 2. Drawing Mode: Render optimistic preview to scratch canvas with 0ms latency
    if (interaction.mode === 'draw' && interaction.draftElement) {
      const draft = interaction.draftElement;
      const scratchCtx = scratchCanvasRef.current?.getContext('2d');
      if (!scratchCtx || !containerRef.current) return;

      const width = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight;

      if (draft.type === 'freehand') {
        (draft as FreehandElement).points.push({ x: worldPoint.x, y: worldPoint.y });
      } else if (draft.type === 'line' || draft.type === 'arrow') {
        const pts = (draft as any).points as Point[];
        pts[1] = { x: worldPoint.x, y: worldPoint.y };
      } else {
        draft.width = worldPoint.x - interaction.startWorldPoint.x;
        draft.height = worldPoint.y - interaction.startWorldPoint.y;
      }

      // Paint scratch canvas immediately (Double Buffering)
      scratchCtx.clearRect(0, 0, width, height);
      scratchCtx.save();
      scratchCtx.translate(viewTransform.panX, viewTransform.panY);
      scratchCtx.scale(viewTransform.zoom, viewTransform.zoom);
      CanvasRenderer.renderDraft(scratchCtx, draft);
      scratchCtx.restore();
      return;
    }

    // 3. Dragging Selected Elements
    if (interaction.mode === 'drag') {
      const dx = worldPoint.x - interaction.startWorldPoint.x;
      const dy = worldPoint.y - interaction.startWorldPoint.y;
      const scratchCtx = scratchCanvasRef.current?.getContext('2d');
      if (!scratchCtx || !containerRef.current) return;

      const width = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight;

      scratchCtx.clearRect(0, 0, width, height);
      scratchCtx.save();
      scratchCtx.translate(viewTransform.panX, viewTransform.panY);
      scratchCtx.scale(viewTransform.zoom, viewTransform.zoom);

      // Render optimistic ghosts on scratch canvas
      interaction.dragInitialElements.forEach((initialEl) => {
        const movedEl = {
          ...initialEl,
          x: initialEl.x + dx,
          y: initialEl.y + dy,
        };
        if (movedEl.type === 'freehand' || movedEl.type === 'line' || movedEl.type === 'arrow') {
          const initPts = (initialEl as any).points as Point[];
          (movedEl as any).points = initPts.map((p) => ({ x: p.x + dx, y: p.y + dy }));
        }
        CanvasRenderer.renderElement(scratchCtx, movedEl);
      });

      scratchCtx.restore();
      return;
    }

    // 4. Resizing Selected Element
    if (interaction.mode === 'resize' && interaction.activeHandle) {
      const handle = interaction.activeHandle;
      const dx = worldPoint.x - interaction.startWorldPoint.x;
      const dy = worldPoint.y - interaction.startWorldPoint.y;

      const scratchCtx = scratchCanvasRef.current?.getContext('2d');
      if (!scratchCtx || !containerRef.current) return;

      const width = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight;

      scratchCtx.clearRect(0, 0, width, height);
      scratchCtx.save();
      scratchCtx.translate(viewTransform.panX, viewTransform.panY);
      scratchCtx.scale(viewTransform.zoom, viewTransform.zoom);

      interaction.dragInitialElements.forEach((initialEl) => {
        let newX = initialEl.x;
        let newY = initialEl.y;
        let newW = initialEl.width;
        let newH = initialEl.height;

        if (handle.includes('r')) newW += dx;
        if (handle.includes('l')) {
          newX += dx;
          newW -= dx;
        }
        if (handle.includes('b')) newH += dy;
        if (handle.includes('t')) {
          newY += dy;
          newH -= dy;
        }

        const resizedEl = { ...initialEl, x: newX, y: newY, width: newW, height: newH };
        CanvasRenderer.renderElement(scratchCtx, resizedEl);
      });

      scratchCtx.restore();
      return;
    }

    // 5. Marquee Selection Box
    if (interaction.mode === 'marquee') {
      const scratchCtx = scratchCanvasRef.current?.getContext('2d');
      if (!scratchCtx || !containerRef.current) return;

      const width = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight;

      const mx = Math.min(interaction.startWorldPoint.x, worldPoint.x);
      const my = Math.min(interaction.startWorldPoint.y, worldPoint.y);
      const mw = Math.abs(worldPoint.x - interaction.startWorldPoint.x);
      const mh = Math.abs(worldPoint.y - interaction.startWorldPoint.y);

      interaction.marqueeBox = { x: mx, y: my, width: mw, height: mh };

      scratchCtx.clearRect(0, 0, width, height);
      scratchCtx.save();
      scratchCtx.translate(viewTransform.panX, viewTransform.panY);
      scratchCtx.scale(viewTransform.zoom, viewTransform.zoom);

      scratchCtx.fillStyle = 'rgba(59, 130, 246, 0.15)';
      scratchCtx.strokeStyle = '#3b82f6';
      scratchCtx.lineWidth = 1 / viewTransform.zoom;
      scratchCtx.setLineDash([4 / viewTransform.zoom, 4 / viewTransform.zoom]);
      scratchCtx.fillRect(mx, my, mw, mh);
      scratchCtx.strokeRect(mx, my, mw, mh);

      scratchCtx.restore();
    }
  };

  /**
   * Pointer Up: Atomically commit to Yjs CRDT Doc and clear scratch canvas
   */
  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const interaction = interactionRef.current;
    if (interaction.mode === 'none') return;

    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const worldPoint = screenToWorld(screenX, screenY, viewTransform);

    // Clear Scratch Canvas
    if (scratchCanvasRef.current && containerRef.current) {
      const scratchCtx = scratchCanvasRef.current.getContext('2d');
      if (scratchCtx) {
        scratchCtx.clearRect(
          0,
          0,
          containerRef.current.clientWidth,
          containerRef.current.clientHeight
        );
      }
    }

    // 1. Commit Newly Drawn Element to Yjs Doc
    if (interaction.mode === 'draw' && interaction.draftElement) {
      const draft = interaction.draftElement;
      // Only commit if element has meaningful dimensions or points
      let isValid = false;
      if (draft.type === 'freehand') {
        isValid = (draft as FreehandElement).points.length > 1;
      } else if (draft.type === 'line' || draft.type === 'arrow') {
        const pts = (draft as any).points as Point[];
        isValid = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) > 4;
      } else {
        isValid = Math.abs(draft.width) > 3 || Math.abs(draft.height) > 3;
      }

      if (isValid) {
        commitElement(draft);
        setSelectedIds([draft.id]);
      }

      // Revert tool to 'select' for shapes, or keep freehand for continuous drawing
      if (activeTool !== 'freehand') {
        setActiveTool('select');
      }
    }

    // 2. Commit Dragged Positions to Yjs Doc
    if (interaction.mode === 'drag') {
      const dx = worldPoint.x - interaction.startWorldPoint.x;
      const dy = worldPoint.y - interaction.startWorldPoint.y;

      if (Math.hypot(dx, dy) > 1) {
        const batch: CanvasElement[] = [];
        interaction.dragInitialElements.forEach((initialEl) => {
          const movedEl = {
            ...initialEl,
            x: initialEl.x + dx,
            y: initialEl.y + dy,
            updatedAt: Date.now(),
          };
          if (movedEl.type === 'freehand' || movedEl.type === 'line' || movedEl.type === 'arrow') {
            const initPts = (initialEl as any).points as Point[];
            (movedEl as any).points = initPts.map((p) => ({ x: p.x + dx, y: p.y + dy }));
          }
          batch.push(movedEl);
        });
        updateElements(batch);
      }
    }

    // 3. Commit Resized Bounds to Yjs Doc
    if (interaction.mode === 'resize' && interaction.activeHandle) {
      const handle = interaction.activeHandle;
      const dx = worldPoint.x - interaction.startWorldPoint.x;
      const dy = worldPoint.y - interaction.startWorldPoint.y;

      const batch: CanvasElement[] = [];
      interaction.dragInitialElements.forEach((initialEl) => {
        let newX = initialEl.x;
        let newY = initialEl.y;
        let newW = initialEl.width;
        let newH = initialEl.height;

        if (handle.includes('r')) newW += dx;
        if (handle.includes('l')) {
          newX += dx;
          newW -= dx;
        }
        if (handle.includes('b')) newH += dy;
        if (handle.includes('t')) {
          newY += dy;
          newH -= dy;
        }

        batch.push({
          ...initialEl,
          x: newX,
          y: newY,
          width: newW,
          height: newH,
          updatedAt: Date.now(),
        });
      });
      updateElements(batch);
    }

    // 4. Finalize Marquee Selection
    if (interaction.mode === 'marquee' && interaction.marqueeBox) {
      const m = interaction.marqueeBox;
      if (m.width > 4 || m.height > 4) {
        const matched = elements.filter((el) => {
          const b = getElementBoundingBox(el);
          return (
            b.x < m.x + m.width &&
            b.x + b.width > m.x &&
            b.y < m.y + m.height &&
            b.y + b.height > m.y
          );
        });
        setSelectedIds(matched.map((el) => el.id));
      }
    }

    // Reset interaction state
    interactionRef.current = {
      mode: 'none',
      startScreenPoint: { x: 0, y: 0 },
      startWorldPoint: { x: 0, y: 0 },
      activeHandle: null,
      dragInitialElements: new Map(),
      draftElement: null,
      marqueeBox: null,
    };

    broadcastCursor(worldPoint, false);
    renderAll();
  };

  /**
   * Trackpad gestures & Mouse wheel handling (Smooth Zoom & Infinite Pan)
   */
  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const mouseScreen = { x: e.clientX - rect.left, y: e.clientY - rect.top };

    if (e.ctrlKey || e.metaKey) {
      // Pinch to Zoom
      const zoomFactor = Math.pow(0.992, e.deltaY);
      const newZoom = Math.max(0.1, Math.min(5, viewTransform.zoom * zoomFactor));

      setViewTransform((prev) => {
        const factor = newZoom / prev.zoom;
        return {
          zoom: newZoom,
          panX: mouseScreen.x - (mouseScreen.x - prev.panX) * factor,
          panY: mouseScreen.y - (mouseScreen.y - prev.panY) * factor,
        };
      });
    } else {
      // 2-finger scroll or wheel panning
      setViewTransform((prev) => ({
        ...prev,
        panX: prev.panX - e.deltaX,
        panY: prev.panY - e.deltaY,
      }));
    }
  };

  /**
   * Commit in-canvas inline text editor
   */
  const commitTextEditor = () => {
    if (!textEditor) return;
    if (textEditor.text.trim()) {
      const textEl: TextElement = {
        id: textEditor.id,
        type: 'text',
        x: textEditor.worldX,
        y: textEditor.worldY,
        width: Math.max(100, textEditor.text.length * (textEditor.fontSize * 0.6)),
        height: textEditor.fontSize * 1.5,
        text: textEditor.text,
        fontSize: textEditor.fontSize,
        fontFamily: textEditor.fontFamily,
        textAlign: 'left',
        strokeColor: textEditor.strokeColor,
        fillColor: 'transparent',
        strokeWidth: 1,
        strokeStyle: 'solid',
        opacity: 1,
        zIndex: elements.length,
        fractionalIndex: '',
        createdBy: 'local',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      commitElement(textEl);
      setSelectedIds([textEl.id]);
    }
    setTextEditor(null);
    setActiveTool('select');
  };

  /**
   * Global Keyboard Shortcuts
   */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in text editor
      if (textEditor) return;

      if (e.code === 'Space' && !e.repeat) {
        setIsSpacePressed(true);
      }

      // Delete / Backspace
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.length > 0) {
        e.preventDefault();
        deleteSelected();
      }

      // Escape: Deselect
      if (e.key === 'Escape') {
        setSelectedIds([]);
        setActiveTool('select');
      }

      // Tool shortcuts (only when not holding modifier keys)
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const key = e.key.toLowerCase();
        if (key === 'v') setActiveTool('select');
        else if (key === 'h') setActiveTool('pan');
        else if (key === 'r') setActiveTool('rectangle');
        else if (key === 'd') setActiveTool('diamond');
        else if (key === 'o') setActiveTool('ellipse');
        else if (key === 'a') setActiveTool('arrow');
        else if (key === 'l') setActiveTool('line');
        else if (key === 'p') setActiveTool('freehand');
        else if (key === 't') setActiveTool('text');
        else if (key === 'e') setActiveTool('eraser');
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsSpacePressed(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [textEditor, selectedIds, deleteSelected, setActiveTool]);

  // Compute cursor style for stage
  const getCursorStyle = () => {
    if (isSpacePressed || activeTool === 'pan') {
      return interactionRef.current.mode === 'pan' ? 'grabbing' : 'grab';
    }
    if (activeTool === 'select') return 'default';
    if (activeTool === 'freehand') return 'crosshair';
    if (activeTool === 'text') return 'text';
    if (activeTool === 'eraser') return 'cell';
    return 'crosshair';
  };

  const textEditorScreen = textEditor
    ? worldToScreen(textEditor.worldX, textEditor.worldY, viewTransform)
    : null;

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden select-none bg-[#121316]"
      style={{ cursor: getCursorStyle() }}
    >
      {/* 1. Background Infinite Grid Canvas */}
      <canvas ref={gridCanvasRef} className="absolute inset-0 block pointer-events-none z-0" />

      {/* 2. Main Committed Elements Canvas */}
      <canvas ref={mainCanvasRef} className="absolute inset-0 block pointer-events-none z-1" />

      {/* 3. Double-Buffered Active Scratch Canvas (Interactive & 0ms drawing) */}
      <canvas
        ref={scratchCanvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => {
          broadcastCursor(null, false);
          if (interactionRef.current.mode !== 'none') {
            interactionRef.current.mode = 'none';
          }
        }}
        onWheel={handleWheel}
        className="absolute inset-0 block touch-none z-10"
      />

      {/* In-Canvas Inline Text Editor */}
      {textEditor && textEditorScreen && (
        <div
          className="absolute z-30"
          style={{
            left: `${textEditorScreen.x}px`,
            top: `${textEditorScreen.y}px`,
            transform: `scale(${viewTransform.zoom})`,
            transformOrigin: 'top left',
          }}
        >
          <textarea
            ref={textEditorRef}
            autoFocus
            value={textEditor.text}
            onChange={(e) => setTextEditor((prev) => prev ? { ...prev, text: e.target.value } : null)}
            onBlur={commitTextEditor}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                commitTextEditor();
              }
              if (e.key === 'Escape') {
                setTextEditor(null);
              }
            }}
            placeholder="Type text here..."
            className="bg-transparent border border-blue-500 rounded p-1 outline-none resize-none font-semibold text-white overflow-hidden shadow-2xl backdrop-blur-xs min-w-[140px]"
            style={{
              fontSize: `${textEditor.fontSize}px`,
              fontFamily: textEditor.fontFamily,
              color: textEditor.strokeColor,
              lineHeight: 1.3,
            }}
            rows={Math.max(1, textEditor.text.split('\n').length)}
          />
        </div>
      )}
    </div>
  );
};
