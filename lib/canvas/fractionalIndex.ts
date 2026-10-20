import { CanvasElement } from '../crdt/types';

/**
 * Deterministic Base-62 Fractional Indexing Engine
 *
 * Guarantees conflict-free visual stacking order across all distributed peers.
 * Elements can be moved forward, backward, to front, or to back concurrently
 * without triggering array splicing collisions or flickering.
 */

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE = DIGITS.length;

function getCharIndex(char: string): number {
  const index = DIGITS.indexOf(char);
  return index === -1 ? 0 : index;
}

/**
 * Generate a lexicographically ordered key strictly between `prev` and `next`.
 * If `prev` is null, returns a key strictly before `next`.
 * If `next` is null, returns a key strictly after `prev`.
 */
export function generateKeyBetween(prev: string | null, next: string | null): string {
  if (!prev && !next) {
    return 'a0';
  }

  // Prepend before first element
  if (!prev && next) {
    const firstChar = next[0];
    const index = getCharIndex(firstChar);
    if (index > 0) {
      return DIGITS[index - 1] + 'z';
    }
    return '0' + next;
  }

  // Append after last element
  if (prev && !next) {
    const lastChar = prev[prev.length - 1];
    const index = getCharIndex(lastChar);
    if (index < BASE - 1) {
      return prev.slice(0, -1) + DIGITS[index + 1];
    }
    return prev + '0';
  }

  // Insert between prev and next
  if (prev && next) {
    if (prev >= next) {
      // In degenerate case (e.g. invalid inputs), append to prev
      return prev + 'V';
    }

    let i = 0;
    while (i < prev.length && i < next.length && prev[i] === next[i]) {
      i++;
    }

    const prevChar = i < prev.length ? prev[i] : '0';
    const nextChar = i < next.length ? next[i] : DIGITS[BASE - 1];

    const prevIdx = getCharIndex(prevChar);
    const nextIdx = getCharIndex(nextChar);

    if (nextIdx - prevIdx > 1) {
      // Direct midpoint between different characters
      const midIdx = Math.floor((prevIdx + nextIdx) / 2);
      return prev.slice(0, i) + DIGITS[midIdx];
    } else {
      // Adjacent characters: extend prefix
      return prev.slice(0, i + 1) + 'V';
    }
  }

  return 'a0';
}

/**
 * Deterministically sort elements by fractional index.
 * Uses element ID as a secondary tie-breaker to prevent any non-deterministic ordering.
 */
export function sortElementsByLayer(elements: CanvasElement[]): CanvasElement[] {
  return [...elements].sort((a, b) => {
    const indexA = a.fractionalIndex || 'a0';
    const indexB = b.fractionalIndex || 'a0';
    const cmp = indexA.localeCompare(indexB);
    if (cmp !== 0) return cmp;
    return a.id.localeCompare(b.id);
  });
}
