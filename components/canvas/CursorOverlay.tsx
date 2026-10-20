'use client';

import React from 'react';
import { InterpolatedCursor, ViewTransform } from '../../lib/crdt/types';
import { worldToScreen } from '../../lib/canvas/math';

interface CursorOverlayProps {
  cursors: InterpolatedCursor[];
  viewTransform: ViewTransform;
}

export const CursorOverlay: React.FC<CursorOverlayProps> = ({ cursors, viewTransform }) => {
  if (!cursors || cursors.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden z-20">
      {cursors.map((cursor) => {
        const screenPos = worldToScreen(cursor.currentX, cursor.currentY, viewTransform);

        // Don't render if outside screen boundary
        if (
          screenPos.x < -100 ||
          screenPos.y < -100 ||
          screenPos.x > window.innerWidth + 100 ||
          screenPos.y > window.innerHeight + 100
        ) {
          return null;
        }

        return (
          <div
            key={cursor.clientId}
            className="absolute transition-transform duration-75 will-change-transform"
            style={{
              transform: `translate(${screenPos.x}px, ${screenPos.y}px)`,
              left: 0,
              top: 0,
            }}
          >
            {/* Custom SVG Cursor Arrow */}
            <svg
              className="drop-shadow-[0_2px_8px_rgba(0,0,0,0.5)]"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M5.65376 12.3673H5.46026L5.31717 12.4976L0.500002 16.8829L0.500002 1.19841L11.7841 12.3673H5.65376Z"
                fill={cursor.color}
                stroke="#ffffff"
                strokeWidth="1.2"
              />
            </svg>

            {/* Collaborator Badge Tag */}
            <div
              className="absolute left-3 top-4 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold text-white shadow-lg whitespace-nowrap select-none backdrop-blur-md"
              style={{
                backgroundColor: cursor.color,
                boxShadow: `0 4px 14px 0 ${cursor.color}40`,
              }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
              <span>{cursor.name}</span>
              {cursor.isDrawing && (
                <span className="opacity-90 font-mono text-[10px] bg-black/20 px-1 rounded">
                  drawing
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
