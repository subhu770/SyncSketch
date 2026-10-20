import { BoundingBox, CanvasElement, FreehandElement, Point, ViewTransform } from '../crdt/types';
import { getCombinedBoundingBox, getElementBoundingBox, getSelectionHandles } from './math';

export class CanvasRenderer {
  /**
   * Set stroke dash pattern based on style
   */
  private static applyStrokeStyle(ctx: CanvasRenderingContext2D, style: string, strokeWidth: number) {
    if (style === 'dashed') {
      ctx.setLineDash([strokeWidth * 3, strokeWidth * 2]);
    } else if (style === 'dotted') {
      ctx.setLineDash([strokeWidth, strokeWidth * 1.5]);
    } else {
      ctx.setLineDash([]);
    }
  }

  /**
   * Render infinite dot grid on canvas
   */
  public static renderGrid(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    transform: ViewTransform,
    isDark: boolean = true
  ) {
    ctx.save();
    ctx.fillStyle = isDark ? '#121316' : '#f8fafc';
    ctx.fillRect(0, 0, width, height);

    const baseGridSize = 28;
    const scaledGrid = baseGridSize * transform.zoom;

    // Fade grid when zoomed far out
    if (scaledGrid > 8) {
      const offsetX = (transform.panX % scaledGrid + scaledGrid) % scaledGrid;
      const offsetY = (transform.panY % scaledGrid + scaledGrid) % scaledGrid;

      ctx.fillStyle = isDark ? 'rgba(255, 255, 255, 0.10)' : 'rgba(0, 0, 0, 0.08)';

      const dotRadius = Math.max(1, Math.min(2, 1.2 * transform.zoom));

      for (let x = offsetX; x < width; x += scaledGrid) {
        for (let y = offsetY; y < height; y += scaledGrid) {
          ctx.beginPath();
          ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.restore();
  }

  /**
   * Render single whiteboard element
   */
  public static renderElement(ctx: CanvasRenderingContext2D, element: CanvasElement) {
    ctx.save();
    ctx.globalAlpha = element.opacity ?? 1;
    ctx.strokeStyle = element.strokeColor;
    ctx.fillStyle = element.fillColor;
    ctx.lineWidth = element.strokeWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    this.applyStrokeStyle(ctx, element.strokeStyle, element.strokeWidth);

    switch (element.type) {
      case 'rectangle': {
        const x = element.width < 0 ? element.x + element.width : element.x;
        const y = element.height < 0 ? element.y + element.height : element.y;
        const w = Math.abs(element.width);
        const h = Math.abs(element.height);
        const r = Math.min(10, w / 4, h / 4);

        ctx.beginPath();
        if (r > 0 && ctx.roundRect) {
          ctx.roundRect(x, y, w, h, r);
        } else {
          ctx.rect(x, y, w, h);
        }

        if (element.fillColor && element.fillColor !== 'transparent') {
          ctx.fill();
        }
        if (element.strokeWidth > 0 && element.strokeColor !== 'transparent') {
          ctx.stroke();
        }
        break;
      }

      case 'ellipse': {
        const x = element.width < 0 ? element.x + element.width : element.x;
        const y = element.height < 0 ? element.y + element.height : element.y;
        const w = Math.abs(element.width);
        const h = Math.abs(element.height);

        ctx.beginPath();
        ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);

        if (element.fillColor && element.fillColor !== 'transparent') {
          ctx.fill();
        }
        if (element.strokeWidth > 0 && element.strokeColor !== 'transparent') {
          ctx.stroke();
        }
        break;
      }

      case 'diamond': {
        const x = element.width < 0 ? element.x + element.width : element.x;
        const y = element.height < 0 ? element.y + element.height : element.y;
        const w = Math.abs(element.width);
        const h = Math.abs(element.height);

        ctx.beginPath();
        ctx.moveTo(x + w / 2, y);
        ctx.lineTo(x + w, y + h / 2);
        ctx.lineTo(x + w / 2, y + h);
        ctx.lineTo(x, y + h / 2);
        ctx.closePath();

        if (element.fillColor && element.fillColor !== 'transparent') {
          ctx.fill();
        }
        if (element.strokeWidth > 0 && element.strokeColor !== 'transparent') {
          ctx.stroke();
        }
        break;
      }

      case 'line': {
        const pts = (element as any).points as Point[];
        if (!pts || pts.length < 2) break;

        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) {
          ctx.lineTo(pts[i].x, pts[i].y);
        }
        ctx.stroke();
        break;
      }

      case 'arrow': {
        const pts = (element as any).points as Point[];
        if (!pts || pts.length < 2) break;

        const start = pts[0];
        const end = pts[pts.length - 1];

        // Draw main line
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();

        // Draw Arrowhead
        const angle = Math.atan2(end.y - start.y, end.x - start.x);
        const headLength = Math.max(14, element.strokeWidth * 4.5);
        const headAngle = Math.PI / 6;

        ctx.beginPath();
        ctx.moveTo(end.x, end.y);
        ctx.lineTo(
          end.x - headLength * Math.cos(angle - headAngle),
          end.y - headLength * Math.sin(angle - headAngle)
        );
        ctx.moveTo(end.x, end.y);
        ctx.lineTo(
          end.x - headLength * Math.cos(angle + headAngle),
          end.y - headLength * Math.sin(angle + headAngle)
        );
        ctx.stroke();
        break;
      }

      case 'freehand': {
        const freehand = element as FreehandElement;
        const pts = freehand.points;
        if (!pts || pts.length === 0) break;

        if (pts.length === 1) {
          ctx.beginPath();
          ctx.arc(pts[0].x, pts[0].y, element.strokeWidth / 2, 0, Math.PI * 2);
          ctx.fillStyle = element.strokeColor;
          ctx.fill();
          break;
        }

        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);

        // Smooth quadratic bezier curves across midpoints
        for (let i = 1; i < pts.length - 1; i++) {
          const xc = (pts[i].x + pts[i + 1].x) / 2;
          const yc = (pts[i].y + pts[i + 1].y) / 2;
          ctx.quadraticCurveTo(pts[i].x, pts[i].y, xc, yc);
        }

        if (pts.length > 1) {
          const last = pts[pts.length - 1];
          ctx.lineTo(last.x, last.y);
        }

        ctx.stroke();
        break;
      }

      case 'text': {
        const textEl = element as any;
        const fontSize = textEl.fontSize || 20;
        const fontFamily = textEl.fontFamily || 'Inter, sans-serif';
        ctx.font = `600 ${fontSize}px ${fontFamily}`;
        ctx.fillStyle = element.strokeColor;
        ctx.textBaseline = 'top';

        const lines = (textEl.text || '').split('\n');
        const lineHeight = fontSize * 1.3;
        lines.forEach((line: string, i: number) => {
          ctx.fillText(line, element.x, element.y + i * lineHeight);
        });
        break;
      }
    }

    ctx.restore();
  }

  /**
   * Render selection bounding box and transform handles
   */
  public static renderSelectionBox(
    ctx: CanvasRenderingContext2D,
    selectedElements: CanvasElement[],
    zoom: number,
    selectionColor: string = '#3B82F6'
  ) {
    if (selectedElements.length === 0) return;
    const box = getCombinedBoundingBox(selectedElements);
    if (!box) return;

    ctx.save();
    ctx.strokeStyle = selectionColor;
    ctx.lineWidth = 1.5 / zoom;
    ctx.setLineDash([4 / zoom, 4 / zoom]);

    const pad = 6 / zoom;
    const bx = box.x - pad;
    const by = box.y - pad;
    const bw = box.width + pad * 2;
    const bh = box.height + pad * 2;

    ctx.strokeRect(bx, by, bw, bh);

    // Render corner & midpoint resize handles
    ctx.setLineDash([]);
    const handles = getSelectionHandles({ x: bx, y: by, width: bw, height: bh }, zoom);
    const handleSize = 8 / zoom;

    handles.forEach((h) => {
      if (h.handle === 'rotate') {
        // Line to rotation handle
        ctx.beginPath();
        ctx.moveTo(bx + bw / 2, by);
        ctx.lineTo(h.x, h.y);
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(h.x, h.y, handleSize / 1.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(h.x - handleSize / 2, h.y - handleSize / 2, handleSize, handleSize);
        ctx.strokeRect(h.x - handleSize / 2, h.y - handleSize / 2, handleSize, handleSize);
      }
    });

    ctx.restore();
  }

  /**
   * Render draft element directly on scratch canvas with zero input lag
   */
  public static renderDraft(ctx: CanvasRenderingContext2D, element: CanvasElement) {
    this.renderElement(ctx, element);
  }
}
