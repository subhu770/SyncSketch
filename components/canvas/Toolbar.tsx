'use client';

import React from 'react';
import {
  MousePointer,
  Hand,
  Square,
  Circle,
  Diamond,
  ArrowUpRight,
  Minus,
  Pencil,
  Type,
  Eraser,
} from 'lucide-react';
import { ToolType } from '../../lib/crdt/types';

interface ToolbarProps {
  activeTool: ToolType;
  onSelectTool: (tool: ToolType) => void;
}

interface ToolItem {
  id: ToolType;
  label: string;
  shortcut: string;
  icon: React.ComponentType<{ className?: string }>;
}

const TOOLS: ToolItem[] = [
  { id: 'select', label: 'Select', shortcut: 'V', icon: MousePointer },
  { id: 'pan', label: 'Hand (Pan)', shortcut: 'H', icon: Hand },
  { id: 'rectangle', label: 'Rectangle', shortcut: 'R', icon: Square },
  { id: 'diamond', label: 'Diamond', shortcut: 'D', icon: Diamond },
  { id: 'ellipse', label: 'Ellipse', shortcut: 'O', icon: Circle },
  { id: 'arrow', label: 'Arrow', shortcut: 'A', icon: ArrowUpRight },
  { id: 'line', label: 'Line', shortcut: 'L', icon: Minus },
  { id: 'freehand', label: 'Draw', shortcut: 'P', icon: Pencil },
  { id: 'text', label: 'Text', shortcut: 'T', icon: Type },
  { id: 'eraser', label: 'Eraser', shortcut: 'E', icon: Eraser },
];

export const Toolbar: React.FC<ToolbarProps> = ({ activeTool, onSelectTool }) => {
  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-30">
      <div className="flex items-center gap-1 p-1.5 bg-[#18191c]/90 backdrop-blur-xl border border-white/10 rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
        {TOOLS.map((tool) => {
          const Icon = tool.icon;
          const isActive = activeTool === tool.id;

          return (
            <button
              key={tool.id}
              onClick={() => onSelectTool(tool.id)}
              title={`${tool.label} (${tool.shortcut})`}
              className={`relative group flex items-center justify-center w-10 h-10 rounded-xl transition-all duration-150 cursor-pointer ${
                isActive
                  ? 'bg-blue-600 text-white shadow-[0_0_16px_rgba(37,99,235,0.5)]'
                  : 'text-zinc-400 hover:text-white hover:bg-white/10'
              }`}
            >
              <Icon className="w-4 h-4 stroke-[2.2]" />

              {/* Keyboard Shortcut Indicator */}
              <span className="absolute bottom-1 right-1 text-[9px] font-mono leading-none opacity-60 font-semibold">
                {tool.shortcut}
              </span>

              {/* Tooltip */}
              <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 px-2 py-1 bg-zinc-900 border border-white/10 text-white text-xs rounded-lg shadow-xl opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity duration-150 whitespace-nowrap z-50">
                {tool.label}
                <kbd className="ml-1.5 px-1 py-0.5 bg-white/10 text-[10px] rounded font-mono">
                  {tool.shortcut}
                </kbd>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
