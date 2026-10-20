'use client';

import React from 'react';
import {
  ArrowUp,
  ArrowDown,
  Trash2,
  Layers,
} from 'lucide-react';
import { StrokeStyle } from '../../lib/crdt/types';
import { StyleOptions } from '../../hooks/useWhiteboard';

interface PropertiesBarProps {
  currentStyle: StyleOptions;
  onChangeStyle: (style: Partial<StyleOptions>) => void;
  hasSelection: boolean;
  onReorder?: (action: 'front' | 'back' | 'forward' | 'backward') => void;
  onDeleteSelected?: () => void;
}

const STROKE_COLORS = [
  '#f8fafc', // White / Slate 50
  '#94a3b8', // Slate 400
  '#ef4444', // Red 500
  '#f97316', // Orange 500
  '#eab308', // Yellow 500
  '#10b981', // Emerald 500
  '#06b6d4', // Cyan 500
  '#3b82f6', // Blue 500
  '#8b5cf6', // Violet 500
  '#ec4899', // Pink 500
];

const FILL_COLORS = [
  'transparent',
  'rgba(255, 255, 255, 0.15)',
  'rgba(239, 68, 68, 0.25)',
  'rgba(249, 115, 22, 0.25)',
  'rgba(234, 179, 8, 0.25)',
  'rgba(16, 185, 129, 0.25)',
  'rgba(6, 182, 212, 0.25)',
  'rgba(59, 130, 246, 0.25)',
  'rgba(139, 92, 246, 0.25)',
  'rgba(236, 72, 153, 0.25)',
];

const STROKE_WIDTHS = [
  { value: 1, label: 'S' },
  { value: 2, label: 'M' },
  { value: 4, label: 'L' },
  { value: 8, label: 'XL' },
];

const STROKE_STYLES: { value: StrokeStyle; label: string }[] = [
  { value: 'solid', label: 'Solid' },
  { value: 'dashed', label: 'Dashed' },
  { value: 'dotted', label: 'Dotted' },
];

export const PropertiesBar: React.FC<PropertiesBarProps> = ({
  currentStyle,
  onChangeStyle,
  hasSelection,
  onReorder,
  onDeleteSelected,
}) => {
  return (
    <div className="fixed top-20 left-4 z-30 flex flex-col gap-3 p-3.5 bg-[#18191c]/90 backdrop-blur-xl border border-white/10 rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.4)] w-60 text-zinc-300 select-none animate-in fade-in slide-in-from-left-4 duration-200">
      <div className="flex items-center justify-between border-b border-white/10 pb-2">
        <span className="text-xs font-semibold tracking-wider uppercase text-zinc-400">
          {hasSelection ? 'Element Style' : 'Default Style'}
        </span>
        {hasSelection && (
          <span className="text-[10px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded font-mono font-medium">
            Active
          </span>
        )}
      </div>

      {/* Stroke Color */}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-zinc-400">Stroke</span>
        <div className="grid grid-cols-5 gap-1.5">
          {STROKE_COLORS.map((color) => (
            <button
              key={color}
              onClick={() => onChangeStyle({ strokeColor: color })}
              className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all cursor-pointer ${
                currentStyle.strokeColor === color
                  ? 'ring-2 ring-blue-500 scale-110'
                  : 'hover:scale-105 opacity-80 hover:opacity-100'
              }`}
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
      </div>

      {/* Fill Color */}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-zinc-400">Fill</span>
        <div className="grid grid-cols-5 gap-1.5">
          {FILL_COLORS.map((color, index) => {
            const isTransparent = color === 'transparent';
            const isSelected = currentStyle.fillColor === color;

            return (
              <button
                key={index}
                onClick={() => onChangeStyle({ fillColor: color })}
                className={`w-8 h-8 rounded-lg relative overflow-hidden flex items-center justify-center transition-all border border-white/10 cursor-pointer ${
                  isSelected
                    ? 'ring-2 ring-blue-500 scale-110'
                    : 'hover:scale-105 opacity-80 hover:opacity-100'
                }`}
                style={{ backgroundColor: isTransparent ? '#27272a' : color }}
              >
                {isTransparent && (
                  <div className="w-full h-0.5 bg-red-400 rotate-45" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Stroke Width */}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-zinc-400">Stroke Width</span>
        <div className="flex items-center gap-1 bg-white/5 p-1 rounded-xl">
          {STROKE_WIDTHS.map((sw) => (
            <button
              key={sw.value}
              onClick={() => onChangeStyle({ strokeWidth: sw.value })}
              className={`flex-1 py-1 rounded-lg text-xs font-semibold font-mono transition-all cursor-pointer ${
                currentStyle.strokeWidth === sw.value
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-white hover:bg-white/10'
              }`}
            >
              {sw.label}
            </button>
          ))}
        </div>
      </div>

      {/* Stroke Style */}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-zinc-400">Stroke Style</span>
        <div className="flex items-center gap-1 bg-white/5 p-1 rounded-xl">
          {STROKE_STYLES.map((st) => (
            <button
              key={st.value}
              onClick={() => onChangeStyle({ strokeStyle: st.value })}
              className={`flex-1 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                currentStyle.strokeStyle === st.value
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-white hover:bg-white/10'
              }`}
            >
              {st.label}
            </button>
          ))}
        </div>
      </div>

      {/* Opacity Slider */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-xs font-medium text-zinc-400">
          <span>Opacity</span>
          <span className="font-mono">{Math.round(currentStyle.opacity * 100)}%</span>
        </div>
        <input
          type="range"
          min="0.1"
          max="1"
          step="0.05"
          value={currentStyle.opacity}
          onChange={(e) => onChangeStyle({ opacity: parseFloat(e.target.value) })}
          className="w-full accent-blue-500 cursor-pointer h-1.5 bg-white/10 rounded-lg appearance-none"
        />
      </div>

      {/* Layer Actions & Delete (Only when selection exists) */}
      {hasSelection && (
        <div className="flex flex-col gap-2 pt-2 border-t border-white/10">
          <div className="flex items-center justify-between gap-1">
            <button
              onClick={() => onReorder?.('front')}
              title="Bring to Front"
              className="flex-1 flex items-center justify-center gap-1 py-1 px-2 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-medium text-zinc-300 hover:text-white cursor-pointer"
            >
              <ArrowUp className="w-3.5 h-3.5" />
              <span>Front</span>
            </button>
            <button
              onClick={() => onReorder?.('back')}
              title="Send to Back"
              className="flex-1 flex items-center justify-center gap-1 py-1 px-2 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-medium text-zinc-300 hover:text-white cursor-pointer"
            >
              <ArrowDown className="w-3.5 h-3.5" />
              <span>Back</span>
            </button>
          </div>

          <button
            onClick={() => onDeleteSelected?.()}
            className="flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 hover:text-red-300 text-xs font-medium transition-colors cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Delete Selected</span>
          </button>
        </div>
      )}
    </div>
  );
};
