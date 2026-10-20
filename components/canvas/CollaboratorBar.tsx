'use client';

import React, { useState } from 'react';
import {
  Share2,
  Download,
  Trash2,
  User,
  Check,
  Sparkles,
  Wifi,
  RefreshCw,
  Radio,
  Activity,
} from 'lucide-react';
import { ConnectionStatus, InterpolatedCursor, TransportType, UserIdentity } from '../../lib/crdt/types';

interface CollaboratorBarProps {
  roomName: string;
  localUser: UserIdentity;
  remoteUsers: InterpolatedCursor[];
  isConnected: boolean;
  connectionStatus?: ConnectionStatus;
  transportType?: TransportType;
  isDebugOpen?: boolean;
  onToggleDebugHUD?: () => void;
  onUpdateUserName: (name: string) => void;
  onExport: (format: 'png' | 'svg' | 'sketch' | 'json') => void;
  onClearCanvas: () => void;
}

export const CollaboratorBar: React.FC<CollaboratorBarProps> = ({
  roomName,
  localUser,
  remoteUsers,
  isConnected,
  connectionStatus = isConnected ? 'connected' : 'connecting',
  transportType = 'websocket',
  isDebugOpen = false,
  onToggleDebugHUD,
  onUpdateUserName,
  onExport,
  onClearCanvas,
}) => {
  const [copied, setCopied] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [tempName, setTempName] = useState(localUser.name);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);

  const handleCopyLink = () => {
    if (typeof window === 'undefined') return;
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSaveName = (e: React.FormEvent) => {
    e.preventDefault();
    if (tempName.trim()) {
      onUpdateUserName(tempName.trim());
      setIsEditingName(false);
    }
  };

  const totalCollaborators = remoteUsers.length + 1;

  // Connection Pill presentation
  const getStatusConfig = () => {
    switch (connectionStatus) {
      case 'connected':
        return {
          color: 'bg-emerald-500',
          textColor: 'text-emerald-400',
          borderColor: 'border-emerald-500/30',
          label: 'Connected',
          icon: <Wifi className="w-3.5 h-3.5 text-emerald-400" />,
          badge: transportType === 'websocket' ? 'WS' : 'P2P',
        };
      case 'reconnecting':
        return {
          color: 'bg-amber-500',
          textColor: 'text-amber-400',
          borderColor: 'border-amber-500/30',
          label: 'Reconnecting...',
          icon: <RefreshCw className="w-3.5 h-3.5 text-amber-400 animate-spin" />,
          badge: transportType === 'webrtc' ? 'P2P Fallback' : 'WS Retry',
        };
      case 'offline':
      default:
        return {
          color: 'bg-red-500',
          textColor: 'text-red-400',
          borderColor: 'border-red-500/30',
          label: 'Offline',
          icon: <Radio className="w-3.5 h-3.5 text-red-400" />,
          badge: 'Disconnected',
        };
    }
  };

  const statusConfig = getStatusConfig();

  return (
    <header className="fixed top-4 left-4 right-4 z-20 flex items-center justify-between pointer-events-none select-none">
      {/* Brand & Room Info */}
      <div className="flex items-center gap-3 pointer-events-auto">
        <div className="flex items-center gap-2.5 px-3.5 py-2 bg-[#18191c]/90 backdrop-blur-xl border border-white/10 rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-blue-600 via-indigo-500 to-fuchsia-500 flex items-center justify-center shadow-[0_0_12px_rgba(99,102,241,0.5)]">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-bold tracking-tight text-white">SyncSketch</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded font-mono font-semibold bg-blue-500/20 text-blue-400 border border-blue-500/30">
                CRDT
              </span>
            </div>
            <span className="text-[10px] font-mono text-zinc-400">
              room: {roomName}
            </span>
          </div>
        </div>

        {/* Live Distributed Connection Status Pill */}
        <div
          className={`hidden sm:flex items-center gap-2 px-3 py-1.5 bg-[#18191c]/90 backdrop-blur-xl border ${statusConfig.borderColor} rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.4)] transition-colors`}
        >
          <span className="relative flex h-2 w-2">
            {connectionStatus === 'connected' && (
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 bg-emerald-400" />
            )}
            <span className={`relative inline-flex rounded-full h-2 w-2 ${statusConfig.color}`} />
          </span>
          <span className={`text-xs font-semibold ${statusConfig.textColor}`}>
            {statusConfig.label}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded font-mono font-medium bg-white/10 text-zinc-300">
            {statusConfig.badge}
          </span>
          <span className="text-xs font-medium text-zinc-400 pl-1 border-l border-white/10">
            {totalCollaborators} {totalCollaborators === 1 ? 'peer' : 'peers'}
          </span>
          {statusConfig.icon}
        </div>
      </div>

      {/* Collaborator Avatars & Action Buttons */}
      <div className="flex items-center gap-2 pointer-events-auto">
        {/* Collaborators Stack */}
        <div className="flex items-center -space-x-2 bg-[#18191c]/90 backdrop-blur-xl border border-white/10 p-1.5 rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
          {/* Local User Avatar */}
          <button
            onClick={() => {
              setTempName(localUser.name);
              setIsEditingName(true);
            }}
            title={`You: ${localUser.name} (Click to rename)`}
            className="relative group w-8 h-8 rounded-full border-2 border-[#18191c] flex items-center justify-center text-xs font-bold text-white shadow-md transition-transform hover:scale-110 z-10 cursor-pointer"
            style={{ backgroundColor: localUser.color }}
          >
            {localUser.name.charAt(0).toUpperCase()}
          </button>

          {/* Remote Users Avatars */}
          {remoteUsers.slice(0, 4).map((user) => (
            <div
              key={user.clientId}
              title={`${user.name} (${user.activeTool})`}
              className="w-8 h-8 rounded-full border-2 border-[#18191c] flex items-center justify-center text-xs font-bold text-white shadow-md transition-transform hover:scale-110"
              style={{ backgroundColor: user.color }}
            >
              {user.name.charAt(0).toUpperCase()}
            </div>
          ))}

          {remoteUsers.length > 4 && (
            <div className="w-8 h-8 rounded-full border-2 border-[#18191c] bg-zinc-700 flex items-center justify-center text-[10px] font-bold text-white shadow-md">
              +{remoteUsers.length - 4}
            </div>
          )}
        </div>

        {/* Share Button */}
        <button
          onClick={handleCopyLink}
          className="flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-2xl shadow-[0_4px_20px_rgba(37,99,235,0.4)] transition-all cursor-pointer"
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Share2 className="w-3.5 h-3.5" />}
          <span>{copied ? 'Copied Link!' : 'Invite'}</span>
        </button>

        {/* Export Dropdown Menu */}
        <div className="relative">
          <button
            onClick={() => setIsExportOpen(!isExportOpen)}
            title="Export canvas options"
            className="flex items-center gap-1.5 px-3 py-2 bg-[#18191c]/90 hover:bg-white/10 text-zinc-300 hover:text-white backdrop-blur-xl border border-white/10 rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.4)] text-xs font-semibold transition-all cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-blue-400" />
            <span className="hidden sm:inline">Export</span>
          </button>

          {isExportOpen && (
            <>
              <div
                className="fixed inset-0 z-30"
                onClick={() => setIsExportOpen(false)}
              />
              <div className="absolute right-0 mt-2 w-56 p-1.5 bg-[#18191c]/95 backdrop-blur-2xl border border-white/15 rounded-2xl shadow-[0_16px_40px_rgba(0,0,0,0.6)] z-40 flex flex-col gap-1 animate-in fade-in zoom-in-95 duration-150">
                <div className="px-2.5 py-1 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
                  Export Canvas
                </div>
                <button
                  onClick={() => {
                    onExport('png');
                    setIsExportOpen(false);
                  }}
                  className="w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-xs text-zinc-200 hover:text-white hover:bg-white/10 transition-colors text-left cursor-pointer"
                >
                  <span className="font-medium">High-Res PNG</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 font-mono">2x Retina</span>
                </button>
                <button
                  onClick={() => {
                    onExport('svg');
                    setIsExportOpen(false);
                  }}
                  className="w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-xs text-zinc-200 hover:text-white hover:bg-white/10 transition-colors text-left cursor-pointer"
                >
                  <span className="font-medium">Clean Vector SVG</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400 font-mono">Vector</span>
                </button>
                <div className="my-1 border-t border-white/10" />
                <div className="px-2.5 py-1 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
                  Backup & Cold Storage
                </div>
                <button
                  onClick={() => {
                    onExport('sketch');
                    setIsExportOpen(false);
                  }}
                  className="w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-xs text-zinc-200 hover:text-white hover:bg-white/10 transition-colors text-left cursor-pointer"
                >
                  <span className="font-medium">Board State Backup</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-mono">.sketch</span>
                </button>
                <button
                  onClick={() => {
                    onExport('json');
                    setIsExportOpen(false);
                  }}
                  className="w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-xs text-zinc-200 hover:text-white hover:bg-white/10 transition-colors text-left cursor-pointer"
                >
                  <span className="font-medium">Raw JSON State</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 font-mono">.json</span>
                </button>
              </div>
            </>
          )}
        </div>

        {/* Performance Profiling HUD Toggle */}
        <button
          onClick={onToggleDebugHUD}
          title="Toggle Performance HUD (Ctrl+Shift+D)"
          className={`p-2.5 backdrop-blur-xl border rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.4)] transition-all cursor-pointer ${
            isDebugOpen
              ? 'text-cyan-400 border-cyan-500/40 bg-cyan-500/20 shadow-[0_0_16px_rgba(6,182,212,0.3)]'
              : 'text-zinc-400 hover:text-white bg-[#18191c]/90 border-white/10 hover:bg-white/10'
          }`}
        >
          <Activity className="w-4 h-4" />
        </button>

        {/* Clear Board Button */}
        <button
          onClick={() => setShowClearConfirm(true)}
          title="Clear Board"
          className="p-2.5 bg-[#18191c]/90 hover:bg-red-500/20 text-zinc-400 hover:text-red-400 backdrop-blur-xl border border-white/10 hover:border-red-500/30 rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.4)] transition-all cursor-pointer"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* Edit User Name Dialog */}
      {isEditingName && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 pointer-events-auto">
          <div className="bg-[#18191c] border border-white/10 p-5 rounded-3xl w-80 shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="flex items-center gap-2 mb-3">
              <User className="w-4 h-4 text-blue-400" />
              <h3 className="text-sm font-semibold text-white">Edit Your Pseudonym</h3>
            </div>
            <form onSubmit={handleSaveName} className="flex flex-col gap-3">
              <input
                type="text"
                value={tempName}
                onChange={(e) => setTempName(e.target.value)}
                maxLength={24}
                autoFocus
                placeholder="Enter display name..."
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <div className="flex items-center justify-end gap-2 mt-1">
                <button
                  type="button"
                  onClick={() => setIsEditingName(false)}
                  className="px-3 py-1.5 rounded-xl text-xs font-medium text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white transition-colors"
                >
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Clear Board Confirmation Dialog */}
      {showClearConfirm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 pointer-events-auto">
          <div className="bg-[#18191c] border border-white/10 p-5 rounded-3xl w-80 shadow-2xl animate-in zoom-in-95 duration-150">
            <h3 className="text-sm font-semibold text-white mb-1.5">Clear entire whiteboard?</h3>
            <p className="text-xs text-zinc-400 mb-4">
              This action will delete all shapes, drawings, and text for everyone in this room.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowClearConfirm(false)}
                className="px-3 py-1.5 rounded-xl text-xs font-medium text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  onClearCanvas();
                  setShowClearConfirm(false);
                }}
                className="px-4 py-1.5 rounded-xl text-xs font-semibold bg-red-600 hover:bg-red-500 text-white transition-colors"
              >
                Clear Everything
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
};
