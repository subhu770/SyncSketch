import { BoundingBox, CanvasElement, HandlePosition, Point, ResizeHandle, ViewTransform } from '../crdt/types';

/**
 * Convert screen coordinate (CSS pixels from canvas bounding rect) to whiteboard world coordinate
 */
export function screenToWorld(
  screenX: number,
  screenY: number,
  transform: ViewTransform
): Point {
  return {
    x: (screenX - transform.panX) / transform.zoom,
    y: (screenY - transform.panY) / transform.zoom,
  };
}

/**
 * Convert whiteboard world coordinate to screen coordinate
 */
export function worldToScreen(
  worldX: number,
  worldY: number,
  transform: ViewTransform
): Point {
  return {
    x: worldX * transform.zoom + transform.panX,
    y: worldY * transform.zoom + transform.panY,
  };
}

/**
 * Get tight axis-aligned bounding box of a canvas element
 */
export function getElementBoundingBox(element: CanvasElement): BoundingBox {
  if (element.type === 'freehand' || element.type === 'line' || element.type === 'arrow') {
    const points = (element as any).points as Point[] || [];
    if (points.length === 0) {
      return { x: element.x, y: element.y, width: element.width || 1, height: element.height || 1 };
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    points.forEach((p) => {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    });

    const padding = element.strokeWidth / 2;
    return {
      x: minX - padding,
      y: minY - padding,
      width: Math.max(10, maxX - minX + padding * 2),
      height: Math.max(10, maxY - minY + padding * 2),
    };
  }

  // Standard geometric elements (rectangle, ellipse, diamond, text)
  const normX = element.width < 0 ? element.x + element.width : element.x;
  const normY = element.height < 0 ? element.y + element.height : element.y;
  const normWidth = Math.abs(element.width);
  const normHeight = Math.abs(element.height);

  return {
    x: normX,
    y: normY,
    width: Math.max(1, normWidth),
    height: Math.max(1, normHeight),
  };
}

/**
 * Combine multiple bounding boxes into an enclosing box
 */
export function getCombinedBoundingBox(elements: CanvasElement[]): BoundingBox | null {
  if (elements.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  elements.forEach((el) => {
    const box = getElementBoundingBox(el);
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  });

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Hit-test whether a world point is on or inside an element
 */
export function isPointInsideElement(point: Point, element: CanvasElement, threshold: number = 6): boolean {
  const box = getElementBoundingBox(element);
  const strokePadding = Math.max(threshold, element.strokeWidth / 2 + 4);

  // Quick bounding box rejection
  if (
    point.x < box.x - strokePadding ||
    point.x > box.x + box.width + strokePadding ||
    point.y < box.y - strokePadding ||
    point.y > box.y + box.height + strokePadding
  ) {
    return false;
  }

  // Specific shape geometry checks
  switch (element.type) {
    case 'rectangle':
    case 'text': {
      // If filled, inside counts; if transparent, stroke boundary counts
      const isFilled = element.fillColor && element.fillColor !== 'transparent';
      if (isFilled) {
        return (
          point.x >= box.x &&
          point.x <= box.x + box.width &&
          point.y >= box.y &&
          point.y <= box.y + box.height
        );
      }
      // Stroke boundary check
      const onLeft = Math.abs(point.x - box.x) <= strokePadding && point.y >= box.y && point.y <= box.y + box.height;
      const onRight = Math.abs(point.x - (box.x + box.width)) <= strokePadding && point.y >= box.y && point.y <= box.y + box.height;
      const onTop = Math.abs(point.y - box.y) <= strokePadding && point.x >= box.x && point.x <= box.x + box.width;
      const onBottom = Math.abs(point.y - (box.y + box.height)) <= strokePadding && point.x >= box.x && point.x <= box.x + box.width;
      return onLeft || onRight || onTop || onBottom;
    }

    case 'ellipse': {
      const rx = box.width / 2;
      const ry = box.height / 2;
      const cx = box.x + rx;
      const cy = box.y + ry;
      if (rx <= 0 || ry <= 0) return false;
      const normDist = Math.pow(point.x - cx, 2) / Math.pow(rx, 2) + Math.pow(point.y - cy, 2) / Math.pow(ry, 2);
      const isFilled = element.fillColor && element.fillColor !== 'transparent';
      if (isFilled) {
        return normDist <= 1.05;
      }
      // Border ring
      return Math.abs(normDist - 1) < 0.25;
    }

    case 'diamond': {
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      const dx = Math.abs(point.x - cx) / (box.width / 2);
      const dy = Math.abs(point.y - cy) / (box.height / 2);
      const isFilled = element.fillColor && element.fillColor !== 'transparent';
      if (isFilled) {
        return dx + dy <= 1.05;
      }
      return Math.abs(dx + dy - 1) < 0.25;
    }

    case 'line':
    case 'arrow': {
      const pts = (element as any).points as Point[];
      if (!pts || pts.length < 2) return false;
      for (let i = 0; i < pts.length - 1; i++) {
        if (distanceToSegment(point, pts[i], pts[i + 1]) <= strokePadding) {
          return true;
        }
      }
      return false;
    }

    case 'freehand': {
      const pts = element.points;
      if (!pts || pts.length === 0) return false;
      for (let i = 0; i < pts.length - 1; i++) {
        if (distanceToSegment(point, pts[i], pts[i + 1]) <= strokePadding) {
          return true;
        }
      }
      return false;
    }

    default:
      return true;
  }
}

/**
 * Shortest distance from a point to a line segment
 */
function distanceToSegment(p: Point, a: Point, b: Point): number {
  const l2 = Math.pow(b.x - a.x, 2) + Math.pow(b.y - a.y, 2);
  if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.y - (a.y + t * (b.y - a.y)));
}

/**
 * Hit test selection handles around a bounding box
 */
export function getSelectionHandles(box: BoundingBox, zoom: number): HandlePosition[] {
  const handles: HandlePosition[] = [
    { handle: 'tl', x: box.x, y: box.y },
    { handle: 'tr', x: box.x + box.width, y: box.y },
    { handle: 'bl', x: box.x, y: box.y + box.height },
    { handle: 'br', x: box.x + box.width, y: box.y + box.height },
    { handle: 'tm', x: box.x + box.width / 2, y: box.y },
    { handle: 'bm', x: box.x + box.width / 2, y: box.y + box.height },
    { handle: 'ml', x: box.x, y: box.y + box.height / 2 },
    { handle: 'mr', x: box.x + box.width, y: box.y + box.height / 2 },
    { handle: 'rotate', x: box.x + box.width / 2, y: box.y - 24 / zoom },
  ];
  return handles;
}

export function hitTestResizeHandle(
  worldPoint: Point,
  box: BoundingBox,
  zoom: number
): ResizeHandle | null {
  const handles = getSelectionHandles(box, zoom);
  const handleRadius = 8 / zoom;

  for (const h of handles) {
    if (Math.hypot(worldPoint.x - h.x, worldPoint.y - h.y) <= handleRadius) {
      return h.handle;
    }
  }
  return null;
}
