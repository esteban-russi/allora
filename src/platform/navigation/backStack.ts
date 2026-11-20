/** Pure navigation back-stack data structure and stack operations. */

export type BackEntryKind = 'destination' | 'overlay';

export interface BackEntry {
  id: string;
  kind: BackEntryKind;
  onPop?: () => void;
  meta?: Record<string, unknown>;
}

export interface BackStackOptions {
  onChange?: (entries: readonly BackEntry[]) => void;
}

/**
 * Manages a navigation history stack supporting destinations and overlays.
 */
export class BackStack {
  private entries: BackEntry[] = [];
  private onChange?: (entries: readonly BackEntry[]) => void;

  /**
   * Initialize a BackStack with optional starting entries and options.
   *
   * Args:
   *   initialEntries: Starting stack entries.
   *   options: Change callbacks.
   */
  constructor(initialEntries: BackEntry[] = [], options?: BackStackOptions) {
    this.entries = [...initialEntries];
    this.onChange = options?.onChange;
  }

  get size(): number {
    return this.entries.length;
  }

  getEntries(): readonly BackEntry[] {
    return [...this.entries];
  }

  peek(): BackEntry | undefined {
    return this.entries[this.entries.length - 1];
  }

  /**
   * Find the active destination below any open overlays.
   *
   * Returns:
   *   The topmost destination entry, or undefined if none.
   */
  currentDestination(): BackEntry | undefined {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      if (this.entries[i].kind === 'destination') {
        return this.entries[i];
      }
    }
    return undefined;
  }

  openOverlays(): readonly BackEntry[] {
    return this.entries.filter((entry) => entry.kind === 'overlay');
  }

  hasOverlay(id: string): boolean {
    return this.entries.some((entry) => entry.kind === 'overlay' && entry.id === id);
  }

  /**
   * Push a destination or overlay onto the stack.
   * Consecutive duplicate destinations are ignored.
   *
   * Args:
   *   entry: The entry to push.
   */
  push(entry: BackEntry): void {
    if (entry.kind === 'destination') {
      const top = this.peek();
      if (top && top.kind === 'destination' && top.id === entry.id) {
        return;
      }
    }
    this.entries.push(entry);
    this.onChange?.(this.getEntries());
  }

  /**
   * Replace the current top entry.
   *
   * Args:
   *   entry: Entry that replaces the current top.
   */
  replace(entry: BackEntry): void {
    if (this.entries.length > 0) {
      this.entries[this.entries.length - 1] = entry;
    } else {
      this.entries.push(entry);
    }
    this.onChange?.(this.getEntries());
  }

  /**
   * Check whether a back action can be handled internally.
   *
   * Returns:
   *   True if an overlay is open or there is more than 1 entry in the stack.
   */
  canPop(): boolean {
    if (this.entries.length === 0) return false;
    const top = this.peek();
    if (top && top.kind === 'overlay') return true;
    return this.entries.length > 1;
  }

  /**
   * Pop the topmost entry and trigger its onPop callback.
   *
   * Returns:
   *   The popped entry, or undefined if the stack cannot be popped.
   */
  pop(): BackEntry | undefined {
    if (!this.canPop()) {
      return undefined;
    }
    const popped = this.entries.pop();
    if (popped) {
      popped.onPop?.();
      this.onChange?.(this.getEntries());
    }
    return popped;
  }

  /**
   * Programmatically close an overlay or screen without triggering its onPop callback.
   *
   * Args:
   *   id: Identifier of the entry to remove.
   *
   * Returns:
   *   The removed entry, or undefined if not found.
   */
  closeWithoutBack(id: string): BackEntry | undefined {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      if (this.entries[i].id === id) {
        const [removed] = this.entries.splice(i, 1);
        this.onChange?.(this.getEntries());
        return removed;
      }
    }
    return undefined;
  }

  /**
   * Reset the stack to a single root destination, dropping all other entries.
   *
   * Args:
   *   root: The destination to set as root.
   */
  resetToRoot(root: BackEntry): void {
    this.entries = [root];
    this.onChange?.(this.getEntries());
  }
}
