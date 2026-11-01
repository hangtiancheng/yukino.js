# @yukino.js/skip-list

A **Redis-style skip list** in TypeScript — an ordered set of `(member, score)`
pairs with `O(log n)` insertion, deletion, rank lookup, and range queries.

The implementation follows Redis's `t_zset.c`: 32 levels by default, a level-up
probability of `0.25`, per-level **span** counters for `O(log n)` rank lookups,
backward pointers for reverse iteration, and a member → node dictionary for
`O(1)` score lookups.

[![npm](https://img.shields.io/npm/v/@yukino.js/skip-list?label=npm&color=F05138)](https://www.npmjs.com/package/@yukino.js/skip-list)
[![License: MIT](https://img.shields.io/badge/License-MIT-f5a623.svg)](../../LICENSE)

## Properties

- **Ordered by score, then member** — ties are broken lexicographically, exactly
  like a Redis sorted set.
- **Rank queries in `O(log n)`** — span counters avoid linear scans.
- **Zero runtime dependencies** — pure TypeScript, ESM.
- **Redis semantics** — 0-based ranks, inclusive/negative range indices,
  exclusive score bounds, and `±Infinity` support.

## Installation

```sh
pnpm add @yukino.js/skip-list
```

## Usage

```ts
import { SkipList } from "@yukino.js/skip-list";

const zset = new SkipList();

zset.add("alice", 100);
zset.add("bob", 75);
zset.add("carol", 75);

zset.toArray();
// [
//   { member: "bob", score: 75 },
//   { member: "carol", score: 75 },
//   { member: "alice", score: 100 },
// ]

zset.score("alice"); // 100
zset.rank("carol"); // 1  (0-based, like ZRANK)
zset.range(0, 1); // [{ member: "bob", score: 75 }, { member: "carol", score: 75 }]
zset.rangeByScore(75, 100); // all three entries
zset.popMax(); // [{ member: "alice", score: 100 }]
```

## API

### `new SkipList(options?)`

| Option        | Type           | Default       | Description                      |
| ------------- | -------------- | ------------- | -------------------------------- |
| `maxLevel`    | `number`       | `32`          | Maximum node level (`1`–`64`)    |
| `probability` | `number`       | `0.25`        | Level-up probability in `(0, 1)` |
| `random`      | `() => number` | `Math.random` | Random source in `[0, 1)`        |

Injecting `random` makes level generation deterministic, which is useful for
tests and reproducible workloads.

### Methods

| Method                                   | Description                                                | Redis equivalent   |
| ---------------------------------------- | ---------------------------------------------------------- | ------------------ |
| `add(member, score): boolean`            | Insert or update an entry; returns whether the set changed | `ZADD`             |
| `delete(member): boolean`                | Remove a member; returns whether it existed                | `ZREM`             |
| `has(member)`                            | Membership test                                            | `ZSCORE` ≠ nil     |
| `score(member)`                          | Score of a member, or `undefined`                          | `ZSCORE`           |
| `rank(member)`                           | 0-based ascending rank, or `-1` when absent                | `ZRANK`            |
| `reverseRank(member)`                    | 0-based descending rank, or `-1` when absent               | `ZREVRANK`         |
| `range(start, stop)`                     | Entries by rank (inclusive, negatives count from the end)  | `ZRANGE`           |
| `reverseRange(start, stop)`              | Entries by rank in descending order                        | `ZREVRANGE`        |
| `rangeByScore(min, max, options?)`       | Entries within a score range; supports `reverse`           | `ZRANGEBYSCORE`    |
| `count(min, max, options?)`              | Number of entries within a score range                     | `ZCOUNT`           |
| `removeRangeByRank(start, stop)`         | Remove a rank range; returns the number removed            | `ZREMRANGEBYRANK`  |
| `removeRangeByScore(min, max, options?)` | Remove a score range; returns the number removed           | `ZREMRANGEBYSCORE` |
| `popMin(count = 1)`                      | Remove and return the lowest entries, ascending            | `ZPOPMIN`          |
| `popMax(count = 1)`                      | Remove and return the highest entries, descending          | `ZPOPMAX`          |
| `first()` / `last()`                     | Lowest / highest entry, or `undefined`                     | `ZRANGE` bounds    |
| `entries()` / `reverseEntries()`         | Ascending / descending iterator                            | —                  |
| `toArray()`                              | Snapshot of all entries in ascending order                 | —                  |
| `clear()`                                | Remove every entry                                         | `DEL`              |
| `length`                                 | Number of entries                                          | `ZCARD`            |
| `[Symbol.iterator]()`                    | Alias for `entries()`                                      | —                  |

`rangeByScore`, `count`, and `removeRangeByScore` accept
`{ minExclusive?: boolean, maxExclusive?: boolean }`; `rangeByScore` also
accepts `{ reverse?: boolean }`.

### Types

```ts
interface Entry {
  readonly member: string;
  readonly score: number;
}

interface SkipListOptions {
  readonly maxLevel?: number;
  readonly probability?: number;
  readonly random?: () => number;
}

interface ScoreRangeOptions {
  readonly minExclusive?: boolean;
  readonly maxExclusive?: boolean;
  readonly reverse?: boolean;
}
```

## Complexity

| Operation                       | Average        |
| ------------------------------- | -------------- |
| `add` / `delete`                | `O(log n)`     |
| `score` / `has`                 | `O(1)`         |
| `rank` / `reverseRank`          | `O(log n)`     |
| `range` / `reverseRange`        | `O(log n + k)` |
| `rangeByScore` / `removeRange…` | `O(log n + k)` |
| `first` / `last`                | `O(1)`         |

## Notes

- Scores may be any `number` except `NaN`; `Infinity` and `-Infinity` are valid.
- Members are ordered by UTF-16 code unit. This matches Redis byte ordering for
  ASCII members.
- `rank()` returns `0` for the lowest entry, matching `ZRANK`; `range` bounds are
  `0`-based and inclusive, and negative indices count from the end.
- Updating the score of an existing member removes and re-inserts the node, just
  as Redis does, so its random level may change.
