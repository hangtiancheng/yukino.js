# @yukino.js/bloom-filter

A standard **Bloom filter** in TypeScript — a space-efficient, probabilistic
set-membership data structure backed by `xxHash32` (via `@node-rs/xxhash`).

[![npm](https://img.shields.io/npm/v/@yukino.js/bloom-filter?label=npm&color=F05138)](https://www.npmjs.com/package/@yukino.js/bloom-filter)
[![License: MIT](https://img.shields.io/badge/License-MIT-f5a623.svg)](../../LICENSE)

## Properties

- **No false negatives** — `has()` returning `false` guarantees the item was
  never added.
- **Possible false positives** — `has()` returning `true` means the item is
  _probably_ present, with probability bounded by the configured rate.
- **Optimal sizing** — bit-array size `m` and hash count `k` are derived from
  `(expectedItems, falsePositiveRate)` using the standard Bloom bounds.
- **Type-namespaced entries** — `add(0)` and `add("0")` are distinct entries.

## Installation

```sh
pnpm add @yukino.js/bloom-filter
```

## Usage

```ts
import { BloomFilter } from "@yukino.js/bloom-filter";

const filter = new BloomFilter(10_000, 0.01); // 10k expected items, 1% FP rate

filter.add("apple").add("banana");

filter.has("apple"); // true
filter.has("cherry"); // false (probably)

// Serialize / restore
const snapshot = filter.serialize();
const restored = BloomFilter.deserialize(snapshot);
```

## API

### `new BloomFilter(expectedItems, falsePositiveRate, seed?)`

| Argument            | Type     | Description                                  |
| ------------------- | -------- | -------------------------------------------- |
| `expectedItems`     | `number` | Expected number of insertions (`n`)          |
| `falsePositiveRate` | `number` | Desired false-positive probability `p∈(0,1)` |
| `seed`              | `number` | Optional hash seed (default `0`)             |

### Methods

| Method                              | Description                                         |
| ----------------------------------- | --------------------------------------------------- |
| `add(item)`                         | Insert an item; returns `this` for chaining         |
| `has(item)`                         | Test for probable membership                        |
| `get estimatedItemCount()`          | Estimated number of unique items inserted           |
| `serialize()`                       | Return a `{ config, data, insertedCount }` snapshot |
| `BloomFilter.deserialize(snapshot)` | Restore a filter from a snapshot                    |

`item` may be a `string`, `number`, or `boolean`.
