export interface SkipListOptions {
  readonly maxLevel?: number;
  readonly probability?: number;
  readonly random?: () => number;
}

export interface Entry {
  readonly member: string;
  readonly score: number;
}

export interface ScoreRangeOptions {
  readonly minExclusive?: boolean;
  readonly maxExclusive?: boolean;
  readonly reverse?: boolean;
}

interface LevelLink {
  forward: SkipListNode | null;
  span: number;
}

class SkipListNode {
  public member: string;
  public score: number;
  public backward: SkipListNode | null = null;
  public readonly levels: LevelLink[];

  constructor(member: string, score: number, levelCount: number) {
    this.member = member;
    this.score = score;
    this.levels = Array.from({ length: levelCount }, () => ({
      forward: null,
      span: 0,
    }));
  }
}

const DEFAULT_MAX_LEVEL = 32;
const DEFAULT_PROBABILITY = 0.25;

function assertMember(member: unknown): asserts member is string {
  if (typeof member !== "string") {
    throw new TypeError(`member must be a string, got ${typeof member}`);
  }
}

function assertScore(score: unknown): asserts score is number {
  if (typeof score !== "number" || Number.isNaN(score)) {
    throw new RangeError(`score must be a number other than NaN, got ${score}`);
  }
}

function assertCount(count: unknown): asserts count is number {
  if (!Number.isInteger(count) || (count as number) < 0) {
    throw new RangeError(`count must be a non-negative integer, got ${count}`);
  }
}

export class SkipList implements Iterable<Entry> {
  private readonly header: SkipListNode;
  private readonly index = new Map<string, SkipListNode>();
  private readonly maxLevel: number;
  private readonly probability: number;
  private readonly random: () => number;

  private tail: SkipListNode | null = null;
  private level = 1;
  private size = 0;

  constructor(options: SkipListOptions = {}) {
    const maxLevel = options.maxLevel ?? DEFAULT_MAX_LEVEL;
    const probability = options.probability ?? DEFAULT_PROBABILITY;
    const random = options.random ?? Math.random;

    if (!Number.isInteger(maxLevel) || maxLevel < 1 || maxLevel > 64) {
      throw new RangeError(
        `maxLevel must be an integer in [1, 64], got ${maxLevel}`,
      );
    }
    if (!(probability > 0 && probability < 1)) {
      throw new RangeError(`probability must be in (0, 1), got ${probability}`);
    }
    if (typeof random !== "function") {
      throw new TypeError("random must be a function");
    }

    this.maxLevel = maxLevel;
    this.probability = probability;
    this.random = random;
    this.header = new SkipListNode("", -Infinity, maxLevel);
  }

  public get length(): number {
    return this.size;
  }

  public add(member: string, score: number): boolean {
    assertMember(member);
    assertScore(score);

    const existing = this.index.get(member);
    if (existing !== undefined) {
      if (existing.score === score) return false;
      this.unlink(existing);
    }

    this.link(member, score);
    return true;
  }

  public delete(member: string): boolean {
    assertMember(member);
    const node = this.index.get(member);
    if (node === undefined) return false;
    this.unlink(node);
    return true;
  }

  public has(member: string): boolean {
    assertMember(member);
    return this.index.has(member);
  }

  public score(member: string): number | undefined {
    assertMember(member);
    return this.index.get(member)?.score;
  }

  public rank(member: string): number {
    assertMember(member);
    const node = this.index.get(member);
    if (node === undefined) return -1;
    return this.oneBasedRank(node) - 1;
  }

  public reverseRank(member: string): number {
    const rank = this.rank(member);
    return rank === -1 ? -1 : this.size - 1 - rank;
  }

  public first(): Entry | undefined {
    const node = this.header.levels[0].forward;
    return node === null ? undefined : toEntry(node);
  }

  public last(): Entry | undefined {
    return this.tail === null ? undefined : toEntry(this.tail);
  }

  public range(start: number, stop: number): Entry[] {
    const bounds = this.normalizeRange(start, stop);
    if (bounds === null) return [];

    const [from, to] = bounds;
    let node = this.nodeByRank(from + 1);
    const result: Entry[] = [];
    while (node !== null && result.length < to - from + 1) {
      result.push(toEntry(node));
      node = node.levels[0].forward;
    }
    return result;
  }

  public reverseRange(start: number, stop: number): Entry[] {
    const bounds = this.normalizeRange(start, stop);
    if (bounds === null) return [];

    const [from, to] = bounds;
    let node = this.nodeByRank(this.size - from);
    const result: Entry[] = [];
    while (node !== null && result.length < to - from + 1) {
      result.push(toEntry(node));
      node = node.backward;
    }
    return result;
  }

  public rangeByScore(
    min: number,
    max: number,
    options: ScoreRangeOptions = {},
  ): Entry[] {
    assertScore(min);
    assertScore(max);
    const minExclusive = options.minExclusive ?? false;
    const maxExclusive = options.maxExclusive ?? false;

    const result: Entry[] = [];
    if (options.reverse === true) {
      let node = this.lastInRange(min, max, minExclusive, maxExclusive);
      while (node !== null && this.gteMin(node.score, min, minExclusive)) {
        result.push(toEntry(node));
        node = node.backward;
      }
    } else {
      let node = this.firstInRange(min, max, minExclusive, maxExclusive);
      while (node !== null && this.lteMax(node.score, max, maxExclusive)) {
        result.push(toEntry(node));
        node = node.levels[0].forward;
      }
    }
    return result;
  }

  public count(
    min: number,
    max: number,
    options: ScoreRangeOptions = {},
  ): number {
    assertScore(min);
    assertScore(max);
    const minExclusive = options.minExclusive ?? false;
    const maxExclusive = options.maxExclusive ?? false;
    const first = this.firstInRange(min, max, minExclusive, maxExclusive);
    if (first === null) return 0;
    const last = this.lastInRange(min, max, minExclusive, maxExclusive);
    if (last === null) return 0;
    return this.oneBasedRank(last) - this.oneBasedRank(first) + 1;
  }

  public removeRangeByRank(start: number, stop: number): number {
    const bounds = this.normalizeRange(start, stop);
    if (bounds === null) return 0;

    const [from, to] = bounds;
    let node = this.nodeByRank(from + 1);
    let removed = 0;
    while (node !== null && removed < to - from + 1) {
      const next = node.levels[0].forward;
      this.unlink(node);
      removed++;
      node = next;
    }
    return removed;
  }

  public removeRangeByScore(
    min: number,
    max: number,
    options: ScoreRangeOptions = {},
  ): number {
    assertScore(min);
    assertScore(max);
    const minExclusive = options.minExclusive ?? false;
    const maxExclusive = options.maxExclusive ?? false;

    let node = this.firstInRange(min, max, minExclusive, maxExclusive);
    let removed = 0;
    while (node !== null && this.lteMax(node.score, max, maxExclusive)) {
      const next = node.levels[0].forward;
      this.unlink(node);
      removed++;
      node = next;
    }
    return removed;
  }

  public popMin(count = 1): Entry[] {
    assertCount(count);
    const result: Entry[] = [];
    while (result.length < count) {
      const node = this.header.levels[0].forward;
      if (node === null) break;
      result.push(toEntry(node));
      this.unlink(node);
    }
    return result;
  }

  public popMax(count = 1): Entry[] {
    assertCount(count);
    const result: Entry[] = [];
    while (result.length < count) {
      const node = this.tail;
      if (node === null) break;
      result.push(toEntry(node));
      this.unlink(node);
    }
    return result;
  }

  public clear(): void {
    for (const link of this.header.levels) {
      link.forward = null;
      link.span = 0;
    }
    this.tail = null;
    this.level = 1;
    this.size = 0;
    this.index.clear();
  }

  public *entries(): IterableIterator<Entry> {
    let node = this.header.levels[0].forward;
    while (node !== null) {
      yield toEntry(node);
      node = node.levels[0].forward;
    }
  }

  public *reverseEntries(): IterableIterator<Entry> {
    let node = this.tail;
    while (node !== null) {
      yield toEntry(node);
      node = node.backward;
    }
  }

  public toArray(): Entry[] {
    return [...this.entries()];
  }

  public [Symbol.iterator](): IterableIterator<Entry> {
    return this.entries();
  }

  private link(member: string, score: number): void {
    const update = new Array<SkipListNode>(this.maxLevel);
    const rank = new Array<number>(this.maxLevel);

    let x = this.header;
    for (let i = this.level - 1; i >= 0; i--) {
      rank[i] = i === this.level - 1 ? 0 : rank[i + 1];
      let next = x.levels[i].forward;
      while (next !== null && this.less(next, score, member)) {
        rank[i] += x.levels[i].span;
        x = next;
        next = x.levels[i].forward;
      }
      update[i] = x;
    }

    const newLevel = this.randomLevel();
    if (newLevel > this.level) {
      for (let i = this.level; i < newLevel; i++) {
        rank[i] = 0;
        update[i] = this.header;
        update[i].levels[i].span = this.size;
      }
      this.level = newLevel;
    }

    const node = new SkipListNode(member, score, newLevel);
    for (let i = 0; i < newLevel; i++) {
      node.levels[i].forward = update[i].levels[i].forward;
      update[i].levels[i].forward = node;
      node.levels[i].span = update[i].levels[i].span - (rank[0] - rank[i]);
      update[i].levels[i].span = rank[0] - rank[i] + 1;
    }
    for (let i = newLevel; i < this.level; i++) {
      update[i].levels[i].span++;
    }

    node.backward = update[0] === this.header ? null : update[0];
    const forward = node.levels[0].forward;
    if (forward !== null) {
      forward.backward = node;
    } else {
      this.tail = node;
    }

    this.size++;
    this.index.set(member, node);
  }

  private unlink(node: SkipListNode): void {
    const update = new Array<SkipListNode>(this.maxLevel);

    let x = this.header;
    for (let i = this.level - 1; i >= 0; i--) {
      let next = x.levels[i].forward;
      while (next !== null && this.less(next, node.score, node.member)) {
        x = next;
        next = x.levels[i].forward;
      }
      update[i] = x;
    }

    for (let i = 0; i < this.level; i++) {
      const target = update[i].levels[i].forward;
      if (target === node) {
        update[i].levels[i].span += node.levels[i].span - 1;
        update[i].levels[i].forward = node.levels[i].forward;
      } else {
        update[i].levels[i].span--;
      }
    }

    const forward = node.levels[0].forward;
    if (forward !== null) {
      forward.backward = node.backward;
    } else {
      this.tail = node.backward;
    }
    while (
      this.level > 1 &&
      this.header.levels[this.level - 1].forward === null
    ) {
      this.level--;
    }

    this.size--;
    this.index.delete(node.member);
  }

  private randomLevel(): number {
    let level = 1;
    while (level < this.maxLevel && this.random() < this.probability) {
      level++;
    }
    return level;
  }

  private nodeByRank(rank: number): SkipListNode | null {
    if (rank <= 0 || rank > this.size) return null;

    let traversed = 0;
    let x = this.header;
    for (let i = this.level - 1; i >= 0; i--) {
      let next = x.levels[i].forward;
      while (next !== null && traversed + x.levels[i].span <= rank) {
        traversed += x.levels[i].span;
        x = next;
        next = x.levels[i].forward;
      }
      if (traversed === rank) return x;
    }
    return null;
  }

  private oneBasedRank(node: SkipListNode): number {
    let rank = 0;
    let x = this.header;
    for (let i = this.level - 1; i >= 0; i--) {
      let next = x.levels[i].forward;
      while (
        next !== null &&
        (next.score < node.score ||
          (next.score === node.score && next.member <= node.member))
      ) {
        rank += x.levels[i].span;
        x = next;
        next = x.levels[i].forward;
      }
      if (x === node) return rank;
    }
    return 0;
  }

  private firstInRange(
    min: number,
    max: number,
    minExclusive: boolean,
    maxExclusive: boolean,
  ): SkipListNode | null {
    if (this.size === 0) return null;

    let x = this.header;
    for (let i = this.level - 1; i >= 0; i--) {
      let next = x.levels[i].forward;
      while (next !== null && !this.gteMin(next.score, min, minExclusive)) {
        x = next;
        next = x.levels[i].forward;
      }
    }

    const node = x.levels[0].forward;
    if (node === null) return null;
    return this.lteMax(node.score, max, maxExclusive) ? node : null;
  }

  private lastInRange(
    min: number,
    max: number,
    minExclusive: boolean,
    maxExclusive: boolean,
  ): SkipListNode | null {
    if (this.size === 0) return null;

    let x = this.header;
    for (let i = this.level - 1; i >= 0; i--) {
      let next = x.levels[i].forward;
      while (next !== null && this.lteMax(next.score, max, maxExclusive)) {
        x = next;
        next = x.levels[i].forward;
      }
    }

    if (x === this.header) return null;
    return this.gteMin(x.score, min, minExclusive) ? x : null;
  }

  private normalizeRange(
    start: number,
    stop: number,
  ): [from: number, to: number] | null {
    if (!Number.isInteger(start) || !Number.isInteger(stop)) {
      throw new RangeError(
        `range bounds must be integers, got ${start} and ${stop}`,
      );
    }

    let from = start < 0 ? this.size + start : start;
    let to = stop < 0 ? this.size + stop : stop;
    if (from < 0) from = 0;
    if (to >= this.size) to = this.size - 1;
    if (this.size === 0 || from > to) return null;
    return [from, to];
  }

  private less(node: SkipListNode, score: number, member: string): boolean {
    return node.score < score || (node.score === score && node.member < member);
  }

  private gteMin(score: number, min: number, exclusive: boolean): boolean {
    return exclusive ? score > min : score >= min;
  }

  private lteMax(score: number, max: number, exclusive: boolean): boolean {
    return exclusive ? score < max : score <= max;
  }
}

function toEntry(node: SkipListNode): Entry {
  return { member: node.member, score: node.score };
}
