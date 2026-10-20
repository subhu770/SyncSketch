'use client';

import React from 'react';
import { Undo2, Redo2, Minus, Plus, Maximize2 } from 'lucide-react';

interface ZoomControlsProps {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  onFitToContent: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

export const ZoomControls: React.FC<ZoomControlsProps> = ({
  zoom,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onFitToContent,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}) => {
  const zoomPercent = Math.round(zoom * 100);

  return (
    <div className="fixed bottom-4 left-4 z-30 flex items-center gap-2 select-none">
      {/* Undo / Redo Group */}
      <div className="flex items-center gap-0.5 p-1 bg-[#18191c]/90 backdrop-blur-xl border border-white/10 rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
        <button
          onClick={onUndo}
          disabled={!canUndo}
          title="Undo (Ctrl+Z)"
          className={`p-2 rounded-lg transition-colors cursor-pointer ${
            canUndo
              ? 'text-zinc-300 hover:text-white hover:bg-white/10'
              : 'text-zinc-600 cursor-not-allowed'
          }`}
        >
          <Undo2 className="w-4 h-4" />
        </button>
        <button
          onClick={onRedo}
          disabled={!canRedo}
          title="Redo (Ctrl+Shift+Z)"
          className={`p-2 rounded-lg transition-colors cursor-pointer ${
            canRedo
              ? 'text-zinc-300 hover:text-white hover:bg-white/10'
              : 'text-zinc-600 cursor-not-allowed'
          }`}
        >
          <Redo2 className="w-4 h-4" />
        </button>
      </div>

      {/* Zoom Group */}
      <div className="flex items-center gap-1 p-1 bg-[#18191c]/90 backdrop-blur-xl border border-white/10 rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
        <button
          onClick={onZoomOut}
          title="Zoom Out (Ctrl+-)"
          className="p-2 rounded-lg text-zinc-300 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
        >
          <Minus className="w-4 h-4" />
        </button>

        <button
          onClick={onResetZoom}
          title="Reset Zoom (Ctrl+0)"
          className="px-2 py-1 rounded-lg text-xs font-mono font-medium text-zinc-300 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
        >
          {zoomPercent}%
        </button>

        <button
          onClick={onZoomIn}
          title="Zoom In (Ctrl++)"
          className="p-2 rounded-lg text-zinc-300 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4" />
        </button>

        <div className="w-px h-4 bg-white/10 mx-0.5" />

        <button
          onClick={onFitToContent}
          title="Fit to Content"
          className="p-2 rounded-lg text-zinc-300 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
