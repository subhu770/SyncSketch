import * as Y from 'yjs';
import { CanvasElement, ElementTombstone } from './types';
import { generateKeyBetween, sortElementsByLayer } from '../canvas/fractionalIndex';

/**
 * Unique symbol/string identifying local mutations
 * Ensures UndoManager only undos actions performed by the current user
 */
export const LOCAL_ORIGIN = 'local-user';

export class WhiteboardDocManager {
  public doc: Y.Doc;
  public elementsMap: Y.Map<CanvasElement>;
  public tombstonesMap: Y.Map<ElementTombstone>;
  public undoManager: Y.UndoManager;
  private pendingMutationsCount: number = 0;
  private subscribers: Set<(elements: Map<string, CanvasElement>, order: string[]) => void> = new Set();

  constructor(doc?: Y.Doc) {
    this.doc = doc || new Y.Doc();
    this.elementsMap = this.doc.getMap<CanvasElement>('canvas-elements');
    this.tombstonesMap = this.doc.getMap<ElementTombstone>('canvas-tombstones');

    // UndoManager strictly tracks changes originating locally
    this.undoManager = new Y.UndoManager([this.elementsMap], {
      trackedOrigins: new Set([LOCAL_ORIGIN, null]),
    });

    this.setupListeners();
  }

  private setupListeners() {
    const notify = () => {
      // Reconcile and resolve any concurrent deletion vs modification conflicts
      const resolvedMap = new Map<string, CanvasElement>();
      const elementsToDelete: string[] = [];

      this.elementsMap.forEach((el, id) => {
        const tombstone = this.tombstonesMap.get(id);
        if (tombstone) {
          // Deletion vs Modification Conflict:
          // If the element's updatedAt is <= tombstone's deletedAt, deletion wins!
          if (el.updatedAt <= tombstone.deletedAt) {
            elementsToDelete.push(id);
            return;
          }
        }
        resolvedMap.set(id, el);
      });

      // Purge resurrected ghost elements if needed
      if (elementsToDelete.length > 0) {
        this.doc.transact(() => {
          elementsToDelete.forEach((id) => this.elementsMap.delete(id));
        }, 'tombstone-reconciliation');
      }

      // Deterministically sort elements by fractional index
      const sortedElements = sortElementsByLayer(Array.from(resolvedMap.values()));
      const sortedOrder = sortedElements.map((el) => el.id);

      this.subscribers.forEach((cb) => cb(resolvedMap, sortedOrder));
    };

    this.elementsMap.observe(() => notify());
    this.tombstonesMap.observe(() => notify());

    this.doc.on('update', (_update: Uint8Array, origin: any) => {
      if (origin === LOCAL_ORIGIN) {
        this.pendingMutationsCount++;
        setTimeout(() => {
          this.pendingMutationsCount = Math.max(0, this.pendingMutationsCount - 1);
        }, 300);
      }
    });
  }

  /**
   * Subscribe to CRDT state changes
   */
  public subscribe(callback: (elements: Map<string, CanvasElement>, order: string[]) => void): () => void {
    this.subscribers.add(callback);

    // Initial emit
    const currentMap = new Map<string, CanvasElement>();
    this.elementsMap.forEach((val, key) => {
      const tombstone = this.tombstonesMap.get(key);
      if (!tombstone || val.updatedAt > tombstone.deletedAt) {
        currentMap.set(key, val);
      }
    });

    const sorted = sortElementsByLayer(Array.from(currentMap.values()));
    callback(currentMap, sorted.map((el) => el.id));

    return () => {
      this.subscribers.delete(callback);
    };
  }

  /**
   * Get highest current fractional index for appending new elements on top
   */
  private getMaxFractionalIndex(): string | null {
    let maxKey: string | null = null;
    this.elementsMap.forEach((el) => {
      if (!maxKey || (el.fractionalIndex && el.fractionalIndex.localeCompare(maxKey) > 0)) {
        maxKey = el.fractionalIndex || null;
      }
    });
    return maxKey;
  }

  /**
   * Optimistically update or insert an element with conflict resolution
   */
  public setElement(element: CanvasElement, origin: any = LOCAL_ORIGIN) {
    const tombstone = this.tombstonesMap.get(element.id);

    // Conflict Check: If this element was previously deleted with a timestamp >= element's updatedAt,
    // deletion strictly wins. Drop mutation to prevent resurrection!
    if (tombstone && element.updatedAt <= tombstone.deletedAt) {
      console.warn(`[SyncSketch CRDT] Dropped mutation on tombstoned element ${element.id}`);
      return;
    }

    this.doc.transact(() => {
      // If element is being recreated with a timestamp strictly greater than deletion, clear tombstone
      if (tombstone && element.updatedAt > tombstone.deletedAt) {
        this.tombstonesMap.delete(element.id);
      }

      // Ensure deterministic fractional index exists
      if (!element.fractionalIndex) {
        const maxIdx = this.getMaxFractionalIndex();
        element.fractionalIndex = generateKeyBetween(maxIdx, null);
      }

      this.elementsMap.set(element.id, element);
    }, origin);
  }

  /**
   * Batch update multiple elements atomically
   */
  public setElements(elements: CanvasElement[], origin: any = LOCAL_ORIGIN) {
    this.doc.transact(() => {
      elements.forEach((el) => {
        const tombstone = this.tombstonesMap.get(el.id);
        if (tombstone && el.updatedAt <= tombstone.deletedAt) {
          return; // Skip tombstoned element
        }

        if (tombstone && el.updatedAt > tombstone.deletedAt) {
          this.tombstonesMap.delete(el.id);
        }

        if (!el.fractionalIndex) {
          const maxIdx = this.getMaxFractionalIndex();
          el.fractionalIndex = generateKeyBetween(maxIdx, null);
        }

        this.elementsMap.set(el.id, el);
      });
    }, origin);
  }

  /**
   * Deterministic Deletion via CRDT Tombstones:
   * Records a permanent tombstone ensuring concurrent modifications do not resurrect the element.
   */
  public deleteElements(ids: string[], origin: any = LOCAL_ORIGIN) {
    const now = Date.now();
    this.doc.transact(() => {
      ids.forEach((id) => {
        // 1. Record Tombstone with deletion timestamp
        this.tombstonesMap.set(id, {
          id,
          deletedAt: now,
          deletedBy: origin ? String(origin) : LOCAL_ORIGIN,
        });

        // 2. Remove element from map
        this.elementsMap.delete(id);
      });
    }, origin);
  }

  /**
   * Deterministic Z-Index / Layer Ordering via Fractional Indexing
   * Eliminates array splicing race conditions across peers.
   */
  public moveElementZIndex(
    id: string,
    action: 'front' | 'back' | 'forward' | 'backward',
    origin: any = LOCAL_ORIGIN
  ) {
    const element = this.elementsMap.get(id);
    if (!element) return;

    // Get strictly sorted elements
    const elementsList = Array.from(this.elementsMap.values());
    const sorted = sortElementsByLayer(elementsList);
    const currentIndex = sorted.findIndex((el) => el.id === id);
    if (currentIndex === -1) return;

    let newIndexKey = element.fractionalIndex;

    if (action === 'front') {
      const topEl = sorted[sorted.length - 1];
      if (topEl && topEl.id !== id) {
        newIndexKey = generateKeyBetween(topEl.fractionalIndex, null);
      }
    } else if (action === 'back') {
      const bottomEl = sorted[0];
      if (bottomEl && bottomEl.id !== id) {
        newIndexKey = generateKeyBetween(null, bottomEl.fractionalIndex);
      }
    } else if (action === 'forward') {
      if (currentIndex < sorted.length - 1) {
        const nextEl = sorted[currentIndex + 1];
        const afterNextEl = sorted[currentIndex + 2] || null;
        newIndexKey = generateKeyBetween(nextEl.fractionalIndex, afterNextEl ? afterNextEl.fractionalIndex : null);
      }
    } else if (action === 'backward') {
      if (currentIndex > 0) {
        const prevEl = sorted[currentIndex - 1];
        const beforePrevEl = sorted[currentIndex - 2] || null;
        newIndexKey = generateKeyBetween(beforePrevEl ? beforePrevEl.fractionalIndex : null, prevEl.fractionalIndex);
      }
    }

    if (newIndexKey !== element.fractionalIndex) {
      this.doc.transact(() => {
        const updated = {
          ...element,
          fractionalIndex: newIndexKey,
          updatedAt: Date.now(),
        };
        this.elementsMap.set(id, updated);
      }, origin);
    }
  }

  /**
   * Reset whiteboard canvas
   */
  public clearAll(origin: any = LOCAL_ORIGIN) {
    const now = Date.now();
    this.doc.transact(() => {
      this.elementsMap.forEach((_, id) => {
        this.tombstonesMap.set(id, {
          id,
          deletedAt: now,
          deletedBy: origin ? String(origin) : LOCAL_ORIGIN,
        });
      });
      this.elementsMap.clear();
    }, origin);
  }

  public getTombstonesCount(): number {
    return this.tombstonesMap.size;
  }

  public getPendingMutationsCount(): number {
    return this.pendingMutationsCount;
  }

  public undo() {
    this.undoManager.undo();
  }

  public redo() {
    this.undoManager.redo();
  }

  public canUndo(): boolean {
    return this.undoManager.undoStack.length > 0;
  }

  public canRedo(): boolean {
    return this.undoManager.redoStack.length > 0;
  }

  public destroy() {
    this.undoManager.destroy();
    this.subscribers.clear();
    this.doc.destroy();
  }
}
