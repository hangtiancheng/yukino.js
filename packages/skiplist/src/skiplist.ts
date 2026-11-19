export const DEFAULT_MAX_LEVEL = 16;
export const DEFAULT_PROBABILITY = 0.5;
export const MAX_LEVEL_LIMIT = 4096;

export type Comparator<K> = (a: K, b: K) => number;
export interface SkipListOptions<K> {
  readonly compare?: Comparator<K>;
  readonly maxLevel?: number;
  readonly probability?: number;
  readonly random?: () => number;
}
export interface Entry<K, V> {
  readonly key: K;
  readonly value: V;
}

/** Go cmp.Compare ordering, including NaN before every other number. Strings
 * use Unicode scalar order (UTF-8 byte order for valid Unicode strings). */
export function compareOrdered<K>(a: K, b: K): number {
  const type = typeof a;
  if (type !== typeof b || !["number", "string", "bigint"].includes(type)) {
    throw new TypeError(
      "skiplist: default keys must have the same number, string or bigint type; supply compare for other keys",
    );
  }
  if (type === "number") {
    if (Number.isNaN(a)) return Number.isNaN(b) ? 0 : -1;
    if (Number.isNaN(b)) return 1;
  }
  if (a === b) return 0;
  if (type === "string") {
    const left = a as string,
      right = b as string;
    let i = 0,
      j = 0;
    while (i < left.length && j < right.length) {
      const x = left.codePointAt(i)!,
        y = right.codePointAt(j)!;
      if (x !== y) return x < y ? -1 : 1;
      i += x > 0xffff ? 2 : 1;
      j += y > 0xffff ? 2 : 1;
    }
    return i === left.length ? -1 : 1;
  }
  return a < b ? -1 : 1;
}

class Node<K, V> {
  readonly forward: (Node<K, V> | undefined)[];
  constructor(
    readonly key: K,
    public value: V,
    height: number,
  ) {
    this.forward = new Array(height);
  }
}

/** Generic ordered map. Key identity is comparator equality. Iterators copy
 * entries when requested, so mutations during iteration cannot corrupt traversal.
 * Keys and values themselves are shallow references and must not be mutated in
 * ways that change key ordering. Comparators/random sources must not reenter. */
export class SkipList<K, V> implements Iterable<Entry<K, V>> {
  readonly maxLevel: number;
  readonly probability: number;
  private readonly compare: Comparator<K>;
  private readonly random: () => number;
  private header: Node<K, V>;
  private height = 0;
  private size = 0;

  constructor(options: SkipListOptions<K> = {}) {
    this.maxLevel = options.maxLevel ?? DEFAULT_MAX_LEVEL;
    this.probability = options.probability ?? DEFAULT_PROBABILITY;
    this.compare = options.compare ?? compareOrdered;
    this.random = options.random ?? Math.random;
    if (
      !Number.isInteger(this.maxLevel) ||
      this.maxLevel < 1 ||
      this.maxLevel > MAX_LEVEL_LIMIT
    ) {
      throw new RangeError(
        `skiplist: maxLevel must be in [1, ${MAX_LEVEL_LIMIT}]`,
      );
    }
    if (!(this.probability > 0 && this.probability < 1))
      throw new RangeError("skiplist: probability must be in (0, 1)");
    if (typeof this.compare !== "function" || typeof this.random !== "function")
      throw new TypeError("skiplist: compare and random must be functions");
    this.header = this.newHeader();
  }

  get length(): number {
    return this.size;
  }
  get level(): number {
    return this.height;
  }

  private newHeader(): Node<K, V> {
    return new Node(undefined as K, undefined as V, this.maxLevel);
  }
  private cmp(a: K, b: K): number {
    const result = this.compare(a, b);
    if (typeof result !== "number" || Number.isNaN(result))
      throw new TypeError("skiplist: comparator must return an ordered number");
    return result;
  }
  private descend(key: K, update?: Node<K, V>[]): Node<K, V> {
    let node = this.header;
    for (let i = this.height - 1; i >= 0; i--) {
      let next = node.forward[i];
      while (next && this.cmp(next.key, key) < 0) {
        node = next;
        next = node.forward[i];
      }
      if (update) update[i] = node;
    }
    return node;
  }
  private find(key: K): Node<K, V> | undefined {
    this.cmp(key, key);
    const node = this.descend(key).forward[0];
    return node && this.cmp(node.key, key) === 0 ? node : undefined;
  }
  private put(
    key: K,
    value: V,
    overwrite: boolean,
  ): [previous: V | undefined, existed: boolean] {
    this.cmp(key, key);
    const update: Node<K, V>[] = [];
    const next = this.descend(key, update).forward[0];
    if (next && this.cmp(next.key, key) === 0) {
      const previous = next.value;
      if (overwrite) next.value = value;
      return [previous, true];
    }
    let height = 1;
    while (height < this.maxLevel) {
      const draw = this.random();
      if (!Number.isFinite(draw) || draw < 0 || draw >= 1)
        throw new RangeError("skiplist: random must return a number in [0, 1)");
      if (draw >= this.probability) break;
      height++;
    }
    // All user code runs before changing any links.
    const node = new Node(key, value, height);
    for (let i = this.height; i < height; i++) update[i] = this.header;
    for (let i = 0; i < height; i++) {
      node.forward[i] = update[i].forward[i];
      update[i].forward[i] = node;
    }
    this.height = Math.max(this.height, height);
    this.size++;
    return [undefined, false];
  }

  insert(key: K, value: V): boolean {
    return !this.put(key, value, false)[1];
  }
  set(key: K, value: V): [previous: V | undefined, existed: boolean] {
    return this.put(key, value, true);
  }
  get(key: K): V | undefined {
    return this.find(key)?.value;
  }
  has(key: K): boolean {
    return this.find(key) !== undefined;
  }
  delete(key: K): [value: V | undefined, deleted: boolean] {
    this.cmp(key, key);
    const update: Node<K, V>[] = [];
    const victim = this.descend(key, update).forward[0];
    if (!victim || this.cmp(victim.key, key) !== 0) return [undefined, false];
    for (let i = 0; i < victim.forward.length; i++)
      update[i].forward[i] = victim.forward[i];
    while (this.height > 0 && !this.header.forward[this.height - 1])
      this.height--;
    this.size--;
    return [victim.value, true];
  }
  clear(): void {
    this.header = this.newHeader();
    this.height = 0;
    this.size = 0;
  }
  min(): Entry<K, V> | undefined {
    return entry(this.header.forward[0]);
  }
  max(): Entry<K, V> | undefined {
    let node = this.header;
    for (let i = this.height - 1; i >= 0; i--)
      while (node.forward[i]) node = node.forward[i]!;
    return node === this.header ? undefined : entry(node);
  }
  floor(key: K): Entry<K, V> | undefined {
    this.cmp(key, key);
    const before = this.descend(key),
      next = before.forward[0];
    if (next && this.cmp(next.key, key) === 0) return entry(next);
    return before === this.header ? undefined : entry(before);
  }
  ceiling(key: K): Entry<K, V> | undefined {
    this.cmp(key, key);
    return entry(this.descend(key).forward[0]);
  }
  snapshot(): Entry<K, V>[] {
    return this.collect(this.header.forward[0]);
  }
  private collect(
    node: Node<K, V> | undefined,
    end?: { key: K },
  ): Entry<K, V>[] {
    const result: Entry<K, V>[] = [];
    while (node && (!end || this.cmp(node.key, end.key) < 0)) {
      result.push(entry(node)!);
      node = node.forward[0];
    }
    return result;
  }
  all(): IterableIterator<Entry<K, V>> {
    return this.snapshot()[Symbol.iterator]();
  }
  range(from: K, to: K): IterableIterator<Entry<K, V>> {
    this.cmp(from, from);
    this.cmp(to, to);
    return this.collect(this.descend(from).forward[0], { key: to })[
      Symbol.iterator
    ]();
  }
  rangeFrom(from: K): IterableIterator<Entry<K, V>> {
    this.cmp(from, from);
    return this.collect(this.descend(from).forward[0])[Symbol.iterator]();
  }
  keys(): IterableIterator<K> {
    return this.snapshot()
      .map((e) => e.key)
      [Symbol.iterator]();
  }
  values(): IterableIterator<V> {
    return this.snapshot()
      .map((e) => e.value)
      [Symbol.iterator]();
  }
  [Symbol.iterator](): IterableIterator<Entry<K, V>> {
    return this.all();
  }
}
function entry<K, V>(node: Node<K, V> | undefined): Entry<K, V> | undefined {
  return node ? { key: node.key, value: node.value } : undefined;
}
