import { ToolError } from '../mcp/tools/result.js';

/** Marks an original item placed elsewhere, by its number. */
class Moved {
  constructor(readonly n: number) {}
}

/**
 * Applies add, update, move and delete operations to a list as it was read. Every number and
 * every `after` position refers to that original list, whatever the other operations do; entries
 * placed at the same position keep the order of the operations. Untouched items come out as the
 * very same objects. Problems are collected, and `result()` throws them all at once.
 */
export class ListEdit<T> {
  readonly problems: string[] = [];
  private readonly items: T[];
  private readonly updated = new Set<number>();
  private readonly moved = new Set<number>();
  private readonly removed = new Set<number>();
  /** What goes after each original position (0 = start): new items, or moved ones. */
  private readonly anchored = new Map<number, Array<T | Moved>>();
  private validated = false;

  constructor(
    private readonly original: readonly T[],
    /** "ingredient" or "step", for the messages. */
    private readonly noun: string
  ) {
    this.items = [...original];
  }

  get count(): number {
    return this.original.length;
  }

  /** Numbers of the deleted items, in the original list. */
  get deleted(): ReadonlySet<number> {
    return this.removed;
  }

  /** Reports a number outside the list; returns whether it is valid. */
  check(n: number, label: string): boolean {
    if (n > this.count) this.problems.push(`${label}: there is no ${this.noun} ${n} (the recipe has ${this.count}).`);
    return n <= this.count;
  }

  add(label: string, after: number | undefined, item: T): void {
    const position = after ?? this.count;
    if (position > this.count) this.problems.push(`${label}: cannot add after ${this.noun} ${position} (the recipe has ${this.count}).`);
    else this.anchor(position, item);
  }

  /** Replaces item `n` with `change(original item)`. */
  update(label: string, n: number, change: (item: T) => T): void {
    if (this.updated.has(n)) this.problems.push(`${label}: ${this.noun} ${n} is updated twice; merge the changes.`);
    if (this.check(n, label)) this.items[n - 1] = change(this.original[n - 1]!);
    this.updated.add(n);
  }

  move(label: string, n: number, after: number): void {
    if (this.moved.has(n)) this.problems.push(`${label}: ${this.noun} ${n} is moved twice.`);
    if (after > this.count) this.problems.push(`${label}: cannot move after ${this.noun} ${after} (the recipe has ${this.count}).`);
    if (this.check(n, label) && after <= this.count) this.anchor(after, new Moved(n));
    this.moved.add(n);
  }

  delete(label: string, n: number): void {
    this.check(n, label);
    this.removed.add(n);
  }

  /** Reports items both deleted and changed. Call it before adding problems of your own, to keep messages in order. */
  validate(): void {
    if (this.validated) return;
    this.validated = true;
    const noun = this.noun.charAt(0).toUpperCase() + this.noun.slice(1);
    for (const n of this.removed) {
      if (this.updated.has(n) || this.moved.has(n)) this.problems.push(`${noun} ${n} is deleted and also updated or moved.`);
    }
  }

  /** The new list; throws a ToolError listing every problem if there is any. */
  result(): T[] {
    this.validate();
    if (this.problems.length) throw new ToolError(this.problems.join('\n'));

    const resolve = (entry: T | Moved) => (entry instanceof Moved ? this.items[entry.n - 1]! : entry);
    const list = (this.anchored.get(0) ?? []).map(resolve);
    for (let n = 1; n <= this.count; n++) {
      if (!this.removed.has(n) && !this.moved.has(n)) list.push(this.items[n - 1]!);
      list.push(...(this.anchored.get(n) ?? []).map(resolve));
    }
    return list;
  }

  private anchor(position: number, entry: T | Moved): void {
    this.anchored.set(position, [...(this.anchored.get(position) ?? []), entry]);
  }
}
