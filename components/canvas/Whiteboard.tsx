'use client';

import React, { useCallback, useEffect } from 'react';
import { useWhiteboard } from '../../hooks/useWhiteboard';
import { CanvasStage } from './CanvasStage';
import { Toolbar } from './Toolbar';
import { PropertiesBar } from './PropertiesBar';
import { CollaboratorBar } from './CollaboratorBar';
import { CursorOverlay } from './CursorOverlay';
import { ZoomControls } from './ZoomControls';
import { DebugHUD } from './DebugHUD';
import { CanvasRenderer } from '../../lib/canvas/renderer';
import { getCombinedBoundingBox } from '../../lib/canvas/math';

import { exportToBoardBackup, exportToPng, exportToSvg } from '../../lib/canvas/export';

interface WhiteboardProps {
  roomName?: string;
}

export const Whiteboard: React.FC<WhiteboardProps> = ({ roomName = 'syncsketch-main' }) => {
  const [isDebugOpen, setIsDebugOpen] = React.useState(false);

  const {
    elements,
    elementsMap,
    activeTool,
    setActiveTool,
    selectedIds,
    setSelectedIds,
    selectedElements,
    currentStyle,
    setStyle,
    viewTransform,
    setViewTransform,
    zoomIn,
    zoomOut,
    resetZoom,
    fitToContent,
    commitElement,
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
  } = useWhiteboard(roomName);

  /**
   * Export Canvas Pipeline (Retina PNG, Clean SVG, .sketch Backup, raw JSON)
   */
  const handleExport = useCallback(
    async (format: 'png' | 'svg' | 'sketch' | 'json') => {
      const activeElements = elements.filter((el) => !el.deletedAt);
      if (activeElements.length === 0) {
        alert('Canvas is empty. Draw some elements first!');
        return;
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const baseName = `syncsketch-${roomName}-${timestamp}`;

      try {
        if (format === 'png') {
          await exportToPng(elements, {
            fileName: `${baseName}.png`,
            scale: 2, // Crisp 2x Retina scaling
            backgroundColor: '#121316',
            padding: 50,
          });
        } else if (format === 'svg') {
          exportToSvg(elements, {
            fileName: `${baseName}.svg`,
            backgroundColor: '#121316',
            padding: 50,
          });
        } else if (format === 'sketch') {
          exportToBoardBackup(elements, {
            fileName: `${baseName}.sketch`,
            roomName,
            format: 'sketch',
          });
        } else if (format === 'json') {
          exportToBoardBackup(elements, {
            fileName: `${baseName}.json`,
            roomName,
            format: 'json',
          });
        }
      } catch (err: any) {
        console.error('Export error:', err);
        alert(`Export failed: ${err.message || 'Unknown error'}`);
      }
    },
    [elements, roomName]
  );

  /**
   * Global Shortcut listener for Undo, Redo, Select All, Zoom
   */
  useEffect(() => {
    const handleGlobalShortcuts = (e: KeyboardEvent) => {
      const isCmdOrCtrl = e.metaKey || e.ctrlKey;

      if (isCmdOrCtrl && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
      } else if (isCmdOrCtrl && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if (isCmdOrCtrl && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSelectedIds(elements.map((el) => el.id));
      } else if (isCmdOrCtrl && e.key === '0') {
        e.preventDefault();
        resetZoom();
      } else if (isCmdOrCtrl && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        zoomIn();
      } else if (isCmdOrCtrl && e.key === '-') {
        e.preventDefault();
        zoomOut();
      } else if (isCmdOrCtrl && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        setIsDebugOpen((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleGlobalShortcuts);
    return () => window.removeEventListener('keydown', handleGlobalShortcuts);
  }, [elements, undo, redo, resetZoom, zoomIn, zoomOut, setSelectedIds]);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#121316]">
      {/* 1. Header Bar: Room Info, Collaborator Avatars, Share & Export */}
      <CollaboratorBar
        roomName={roomName}
        localUser={localUser}
        remoteUsers={remoteUsers}
        isConnected={isConnected}
        connectionStatus={connectionStatus}
        transportType={transportType}
        isDebugOpen={isDebugOpen}
        onToggleDebugHUD={() => setIsDebugOpen(!isDebugOpen)}
        onUpdateUserName={updateUserName}
        onExport={handleExport}
        onClearCanvas={clearCanvas}
      />

      {/* 2. Top Floating Tool Dock */}
      <Toolbar activeTool={activeTool} onSelectTool={setActiveTool} />

      {/* 3. Left Floating Styling & Layer Properties */}
      <PropertiesBar
        currentStyle={currentStyle}
        onChangeStyle={setStyle}
        hasSelection={selectedIds.length > 0}
        onReorder={reorderSelected}
        onDeleteSelected={deleteSelected}
      />

      {/* 4. Bottom Left Zoom & Undo/Redo Controls */}
      <ZoomControls
        zoom={viewTransform.zoom}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onResetZoom={resetZoom}
        onFitToContent={() => {
          if (typeof window !== 'undefined') {
            fitToContent(window.innerWidth, window.innerHeight);
          }
        }}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={undo}
        onRedo={redo}
      />

      {/* 5. Smooth Remote Collaborator Cursors Overlay */}
      <CursorOverlay cursors={remoteUsers} viewTransform={viewTransform} />

      {/* 6. Core Multi-Layered HTML5 Canvas Stage */}
      <CanvasStage
        elements={elements}
        activeTool={activeTool}
        setActiveTool={setActiveTool}
        selectedIds={selectedIds}
        setSelectedIds={setSelectedIds}
        currentStyle={currentStyle}
        viewTransform={viewTransform}
        setViewTransform={setViewTransform}
        commitElement={commitElement}
        updateElements={updateElements}
        deleteSelected={deleteSelected}
        broadcastCursor={broadcastCursor}
      />

      {/* 7. Performance Profiling Debug HUD */}
      <DebugHUD
        totalElements={elements.length}
        peerCount={remoteUsers.length + 1}
        pendingMutations={pendingMutations}
        tombstonesCount={tombstonesCount}
        connectionStatus={connectionStatus}
        transportType={transportType}
        isStorageSynced={isStorageSynced}
        isOpen={isDebugOpen}
        onClose={() => setIsDebugOpen(false)}
      />
    </div>
  );
};
