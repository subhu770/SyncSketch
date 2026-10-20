'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  Gauge,
  Users,
  Database,
  Layers,
  ShieldAlert,
  ChevronDown,
  ChevronUp,
  X,
  Wifi,
} from 'lucide-react';
import { ConnectionStatus, TransportType } from '../../lib/crdt/types';

interface DebugHUDProps {
  totalElements: number;
  peerCount: number;
  pendingMutations: number;
  tombstonesCount: number;
  connectionStatus: ConnectionStatus;
  transportType: TransportType;
  isStorageSynced: boolean;
  isOpen: boolean;
  onClose: () => void;
}

export const DebugHUD: React.FC<DebugHUDProps> = ({
  totalElements,
  peerCount,
  pendingMutations,
  tombstonesCount,
  connectionStatus,
  transportType,
  isStorageSynced,
  isOpen,
  onClose,
}) => {
  const [fps, setFps] = useState<number>(60);
  const [pingMs, setPingMs] = useState<number | null>(null);
  const [isMinimized, setIsMinimized] = useState<boolean>(false);

  const frameCountRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(performance.now());
  const rafIdRef = useRef<number | null>(null);

  // 1. Calculate real-time FPS
  useEffect(() => {
    const loop = (now: number) => {
      frameCountRef.current++;
      const delta = now - lastTimeRef.current;

      if (delta >= 500) {
        const currentFps = Math.round((frameCountRef.current * 1000) / delta);
        setFps(Math.min(120, currentFps));
        frameCountRef.current = 0;
        lastTimeRef.current = now;
      }

      rafIdRef.current = requestAnimationFrame(loop);
    };

    rafIdRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
    };
  }, []);

  // 2. Measure ping latency to backend server (port 1234)
  useEffect(() => {
    let timer: NodeJS.Timeout;

    const measurePing = async () => {
      if (typeof window === 'undefined') return;
      const start = performance.now();
      try {
        const res = await fetch('http://localhost:1234/health', {
          method: 'GET',
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache' },
        });
        if (res.ok) {
          const latency = Math.round(performance.now() - start);
          setPingMs(latency);
        } else {
          setPingMs(null);
        }
      } catch {
        setPingMs(null);
      }
    };

    measurePing();
    timer = setInterval(measurePing, 2000);
    return () => clearInterval(timer);
  }, []);

  if (!isOpen) return null;

  const getFpsColor = (val: number) => {
    if (val >= 55) return 'text-emerald-400';
    if (val >= 30) return 'text-amber-400';
    return 'text-red-400';
  };

  const getPingColor = (val: number | null) => {
    if (val === null) return 'text-zinc-500';
    if (val <= 40) return 'text-emerald-400';
    if (val <= 120) return 'text-amber-400';
    return 'text-red-400';
  };

  return (
    <div className="fixed bottom-4 right-4 z-40 select-none animate-in fade-in slide-in-from-bottom-2 duration-200">
      <div className="w-72 bg-[#18191c]/95 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-[0_12px_40px_rgba(0,0,0,0.6)] overflow-hidden text-xs">
        {/* Header Bar */}
        <div className="flex items-center justify-between px-3.5 py-2.5 bg-white/5 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-cyan-400 animate-pulse" />
            <span className="font-semibold text-white tracking-wide">SyncSketch HUD</span>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setIsMinimized(!isMinimized)}
              className="p-1 text-zinc-400 hover:text-white rounded hover:bg-white/10 transition-colors cursor-pointer"
              title={isMinimized ? 'Expand HUD' : 'Collapse HUD'}
            >
              {isMinimized ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={onClose}
              className="p-1 text-zinc-400 hover:text-red-400 rounded hover:bg-white/10 transition-colors cursor-pointer"
              title="Close HUD (Ctrl+Shift+D)"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        {!isMinimized && (
          <div className="p-3.5 flex flex-col gap-2.5 font-mono">
            {/* Primary Metrics: FPS & Latency */}
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-0.5 p-2 rounded-xl bg-white/5 border border-white/5">
                <div className="flex items-center justify-between text-zinc-400 text-[10px]">
                  <span>RENDER FPS</span>
                  <Gauge className="w-3 h-3 text-zinc-500" />
                </div>
                <div className="flex items-baseline gap-1">
                  <span className={`text-lg font-bold ${getFpsColor(fps)}`}>{fps}</span>
                  <span className="text-[10px] text-zinc-500">fps</span>
                </div>
              </div>

              <div className="flex flex-col gap-0.5 p-2 rounded-xl bg-white/5 border border-white/5">
                <div className="flex items-center justify-between text-zinc-400 text-[10px]">
                  <span>WS PING</span>
                  <Wifi className="w-3 h-3 text-zinc-500" />
                </div>
                <div className="flex items-baseline gap-1">
                  <span className={`text-lg font-bold ${getPingColor(pingMs)}`}>
                    {pingMs !== null ? pingMs : 'offline'}
                  </span>
                  {pingMs !== null && <span className="text-[10px] text-zinc-500">ms</span>}
                </div>
              </div>
            </div>

            {/* Telemetry Rows */}
            <div className="flex flex-col gap-1.5 pt-1 text-zinc-300">
              {/* Peers */}
              <div className="flex items-center justify-between py-1 border-b border-white/5">
                <div className="flex items-center gap-1.5 text-zinc-400">
                  <Users className="w-3.5 h-3.5 text-blue-400" />
                  <span>Active Peers</span>
                </div>
                <span className="font-semibold text-white">{peerCount}</span>
              </div>

              {/* Pending Mutations */}
              <div className="flex items-center justify-between py-1 border-b border-white/5">
                <div className="flex items-center gap-1.5 text-zinc-400">
                  <Activity className="w-3.5 h-3.5 text-amber-400" />
                  <span>Pending Mutations</span>
                </div>
                <span className={`font-semibold ${pendingMutations > 0 ? 'text-amber-400' : 'text-zinc-400'}`}>
                  {pendingMutations}
                </span>
              </div>

              {/* Elements & Tombstones */}
              <div className="flex items-center justify-between py-1 border-b border-white/5">
                <div className="flex items-center gap-1.5 text-zinc-400">
                  <Layers className="w-3.5 h-3.5 text-purple-400" />
                  <span>Active Elements</span>
                </div>
                <span className="font-semibold text-white">{totalElements}</span>
              </div>

              <div className="flex items-center justify-between py-1 border-b border-white/5">
                <div className="flex items-center gap-1.5 text-zinc-400">
                  <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
                  <span>Tombstones (Pruned)</span>
                </div>
                <span className="font-semibold text-rose-300">{tombstonesCount}</span>
              </div>

              {/* IndexedDB Persistence */}
              <div className="flex items-center justify-between py-1 border-b border-white/5">
                <div className="flex items-center gap-1.5 text-zinc-400">
                  <Database className="w-3.5 h-3.5 text-emerald-400" />
                  <span>IndexedDB</span>
                </div>
                <span className="text-[11px] font-semibold text-emerald-400">
                  {isStorageSynced ? 'Synced (Offline-Ready)' : 'Syncing...'}
                </span>
              </div>

              {/* Transport Protocol */}
              <div className="flex items-center justify-between pt-1">
                <span className="text-zinc-500 text-[10px]">TRANSPORT</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded font-bold uppercase bg-blue-500/20 text-blue-400">
                  {transportType === 'websocket' ? 'WebSocket (Port 1234)' : 'WebRTC Fallback'}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
