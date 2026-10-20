'use client';

import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Whiteboard } from '@/components/canvas/Whiteboard';

function WhiteboardWithParams() {
  const searchParams = useSearchParams();
  const room = searchParams.get('room') || 'syncsketch-alpha';

  return <Whiteboard roomName={room} />;
}

export default function Home() {
  return (
    <Suspense
      fallback={
        <div className="w-screen h-screen bg-[#121316] flex items-center justify-center text-zinc-400 font-mono text-sm">
          <div className="flex items-center gap-3">
            <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <span>Connecting to SyncSketch collaborative CRDT room...</span>
          </div>
        </div>
      }
    >
      <WhiteboardWithParams />
    </Suspense>
  );
}
