import { CanvasElement, FreehandElement, Point } from '../crdt/types';
import { CanvasRenderer } from './renderer';
import { getCombinedBoundingBox } from './math';
import { sortElementsByLayer } from './fractionalIndex';

export interface ExportOptions {
  fileName?: string;
  backgroundColor?: string;
  padding?: number;
  scale?: number; // e.g. 2 for Retina
}

/**
 * Trigger browser file download
 */
function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Filter out deleted/tombstoned elements and sort in deterministic z-index order
 */
export function getSortedActiveElements(elements: CanvasElement[]): CanvasElement[] {
  const active = elements.filter((el) => !el.deletedAt);
  return sortElementsByLayer(active);
}

/**
 * 1. High-Resolution Retina PNG Export (2x default scaling)
 */
export async function exportToPng(
  elements: CanvasElement[],
  options: ExportOptions = {}
): Promise<void> {
  const activeElements = getSortedActiveElements(elements);
  const scale = options.scale ?? 2; // 2x for crisp Retina screens
  const padding = options.padding ?? 40;
  const bgColor = options.backgroundColor ?? '#121316';
  const fileName = options.fileName || `syncsketch-${Date.now()}.png`;

  // Determine bounding box
  let minX = 0;
  let minY = 0;
  let width = 1200;
  let height = 800;

  if (activeElements.length > 0) {
    const bbox = getCombinedBoundingBox(activeElements);
    if (bbox) {
      minX = bbox.x - padding;
      minY = bbox.y - padding;
      width = Math.max(200, bbox.width + padding * 2);
      height = Math.max(150, bbox.height + padding * 2);
    }
  }

  // Create offscreen canvas
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to create offscreen 2D rendering context');
  }

  // Scale and translate
  ctx.scale(scale, scale);

  // Background fill
  if (bgColor && bgColor !== 'transparent') {
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, width, height);
  }

  // Translate world coordinates into canvas space
  ctx.translate(-minX, -minY);

  // Render elements in deterministic order
  activeElements.forEach((el) => {
    CanvasRenderer.renderElement(ctx, el);
  });

  // Convert to Blob and trigger download
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        downloadBlob(blob, fileName);
        resolve();
      } else {
        reject(new Error('Failed to generate PNG blob'));
      }
    }, 'image/png');
  });
}

/**
 * 2. Clean SVG Vector Format Export
 */
export function exportToSvg(
  elements: CanvasElement[],
  options: ExportOptions = {}
): void {
  const activeElements = getSortedActiveElements(elements);
  const padding = options.padding ?? 40;
  const bgColor = options.backgroundColor ?? '#121316';
  const fileName = options.fileName || `syncsketch-${Date.now()}.svg`;

  let minX = 0;
  let minY = 0;
  let width = 1200;
  let height = 800;

  if (activeElements.length > 0) {
    const bbox = getCombinedBoundingBox(activeElements);
    if (bbox) {
      minX = Math.floor(bbox.x - padding);
      minY = Math.floor(bbox.y - padding);
      width = Math.ceil(Math.max(200, bbox.width + padding * 2));
      height = Math.ceil(Math.max(150, bbox.height + padding * 2));
    }
  }

  const svgParts: string[] = [];

  // SVG Header & Defs
  svgParts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${width} ${height}" width="${width}" height="${height}">`
  );
  svgParts.push('  <defs>');
  svgParts.push('    <style>');
  svgParts.push('      .syncsketch-shape { stroke-linecap: round; stroke-linejoin: round; }');
  svgParts.push('      .syncsketch-text { font-family: Inter, system-ui, sans-serif; font-weight: 600; }');
  svgParts.push('    </style>');
  svgParts.push('  </defs>');

  // Background
  if (bgColor && bgColor !== 'transparent') {
    svgParts.push(
      `  <rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="${bgColor}" />`
    );
  }

  // Convert elements into SVG markup
  for (const el of activeElements) {
    const opacity = el.opacity ?? 1;
    const stroke = el.strokeColor || 'none';
    const fill = el.fillColor && el.fillColor !== 'transparent' ? el.fillColor : 'none';
    const strokeWidth = el.strokeWidth || 1;

    let dashAttr = '';
    if (el.strokeStyle === 'dashed') {
      dashAttr = `stroke-dasharray="${strokeWidth * 3},${strokeWidth * 2}"`;
    } else if (el.strokeStyle === 'dotted') {
      dashAttr = `stroke-dasharray="${strokeWidth},${strokeWidth * 1.5}"`;
    }

    const commonAttrs = `stroke="${stroke}" fill="${fill}" stroke-width="${strokeWidth}" opacity="${opacity}" ${dashAttr} class="syncsketch-shape"`;

    switch (el.type) {
      case 'rectangle': {
        const x = el.width < 0 ? el.x + el.width : el.x;
        const y = el.height < 0 ? el.y + el.height : el.y;
        const w = Math.abs(el.width);
        const h = Math.abs(el.height);
        const r = Math.min(8, w / 4, h / 4);
        svgParts.push(`  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" ${commonAttrs} />`);
        break;
      }

      case 'ellipse': {
        const x = el.width < 0 ? el.x + el.width : el.x;
        const y = el.height < 0 ? el.y + el.height : el.y;
        const w = Math.abs(el.width);
        const h = Math.abs(el.height);
        const cx = x + w / 2;
        const cy = y + h / 2;
        const rx = w / 2;
        const ry = h / 2;
        svgParts.push(`  <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" ${commonAttrs} />`);
        break;
      }

      case 'diamond': {
        const x = el.width < 0 ? el.x + el.width : el.x;
        const y = el.height < 0 ? el.y + el.height : el.y;
        const w = Math.abs(el.width);
        const h = Math.abs(el.height);
        const points = `${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}`;
        svgParts.push(`  <polygon points="${points}" ${commonAttrs} />`);
        break;
      }

      case 'line': {
        const pts = (el as any).points as Point[];
        if (!pts || pts.length < 2) break;
        const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
        svgParts.push(`  <path d="${d}" ${commonAttrs} fill="none" />`);
        break;
      }

      case 'arrow': {
        const pts = (el as any).points as Point[];
        if (!pts || pts.length < 2) break;
        const start = pts[0];
        const end = pts[pts.length - 1];

        const angle = Math.atan2(end.y - start.y, end.x - start.x);
        const headLength = Math.max(14, strokeWidth * 4.5);
        const headAngle = Math.PI / 6;

        const leftX = end.x - headLength * Math.cos(angle - headAngle);
        const leftY = end.y - headLength * Math.sin(angle - headAngle);
        const rightX = end.x - headLength * Math.cos(angle + headAngle);
        const rightY = end.y - headLength * Math.sin(angle + headAngle);

        const dLine = `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
        const dHead = `M ${leftX} ${leftY} L ${end.x} ${end.y} L ${rightX} ${rightY}`;

        svgParts.push(`  <path d="${dLine}" ${commonAttrs} fill="none" />`);
        svgParts.push(`  <path d="${dHead}" stroke="${stroke}" stroke-width="${strokeWidth}" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}" />`);
        break;
      }

      case 'freehand': {
        const freehand = el as FreehandElement;
        const pts = freehand.points;
        if (!pts || pts.length === 0) break;

        if (pts.length === 1) {
          svgParts.push(
            `  <circle cx="${pts[0].x}" cy="${pts[0].y}" r="${strokeWidth / 2}" fill="${stroke}" opacity="${opacity}" />`
          );
          break;
        }

        let d = `M ${pts[0].x} ${pts[0].y}`;
        for (let i = 1; i < pts.length - 1; i++) {
          const xc = (pts[i].x + pts[i + 1].x) / 2;
          const yc = (pts[i].y + pts[i + 1].y) / 2;
          d += ` Q ${pts[i].x} ${pts[i].y}, ${xc} ${yc}`;
        }
        if (pts.length > 1) {
          const last = pts[pts.length - 1];
          d += ` L ${last.x} ${last.y}`;
        }

        svgParts.push(`  <path d="${d}" ${commonAttrs} fill="none" />`);
        break;
      }

      case 'text': {
        const textEl = el as any;
        const fontSize = textEl.fontSize || 20;
        const fontFamily = textEl.fontFamily || 'Inter, system-ui, sans-serif';
        const lines = (textEl.text || '').split('\n');
        const lineHeight = fontSize * 1.3;

        svgParts.push(
          `  <text x="${el.x}" y="${el.y + fontSize}" fill="${stroke}" font-size="${fontSize}" font-family="${fontFamily}" opacity="${opacity}" class="syncsketch-text">`
        );
        lines.forEach((line: string, i: number) => {
          svgParts.push(
            `    <tspan x="${el.x}" dy="${i === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`
          );
        });
        svgParts.push('  </text>');
        break;
      }
    }
  }

  svgParts.push('</svg>');
  const svgString = svgParts.join('\n');
  const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  downloadBlob(blob, fileName);
}

/**
 * 3. Board State Backup (.sketch / JSON)
 */
export function exportToBoardBackup(
  elements: CanvasElement[],
  options: { fileName?: string; roomName?: string; format?: 'sketch' | 'json' } = {}
): void {
  const activeElements = getSortedActiveElements(elements);
  const ext = options.format === 'json' ? 'json' : 'sketch';
  const fileName = options.fileName || `syncsketch-board-${Date.now()}.${ext}`;

  const payload = {
    app: 'SyncSketch',
    version: 1,
    exportedAt: new Date().toISOString(),
    roomName: options.roomName || 'SyncSketch Board',
    elementCount: activeElements.length,
    elements: activeElements,
  };

  const jsonString = JSON.stringify(payload, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8' });
  downloadBlob(blob, fileName);
}

/**
 * XML escape helper for SVG text
 */
function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
