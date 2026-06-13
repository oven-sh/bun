// Array.fromAsync type tests — bun-types provides this declaration aligned
// with TypeScript's lib.esnext.array.d.ts so it works with any lib config.

import { expectType } from "./utilities";

async function* listReleases() {
  for (let page = 1; ; page++) {
    const response = await fetch(`https://api.github.com/repos/oven-sh/bun/releases?page=${page}`);
    const releases = (await response.json()) as Array<{ data: string }>;
    if (!releases.length) {
      break;
    }
    for (const release of releases) {
      yield release;
    }
  }
}

// AsyncIterable input
const releases = await Array.fromAsync(listReleases());
expectType<{ data: string }[]>(releases);

// Tests from issue #8484
// https://github.com/oven-sh/bun/issues/8484
async function* naturals() {
  for (let i = 0; i < 10; i++) {
    yield i;
  }
}

// AsyncIterable input with mapFn
const test1 = await Array.fromAsync(naturals(), n => Promise.resolve(`${n}`));
expectType<string[]>(test1);

// Iterable<PromiseLike<T>> input — promises are unwrapped
const test2 = await Array.fromAsync([Promise.resolve(1), Promise.resolve(2)]);
expectType<number[]>(test2);

// Plain iterable input
const test3 = await Array.fromAsync([1, 2, 3]);
expectType<number[]>(test3);

// ArrayLike input with mapFn
const test4 = await Array.fromAsync({ length: 3, 0: "a", 1: "b", 2: "c" }, s => s.toUpperCase());
expectType<string[]>(test4);

export {};
