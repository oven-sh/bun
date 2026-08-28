import { expectType } from "./utilities";

// https://github.com/oven-sh/bun/issues/27380
// Map.prototype.getOrInsert / getOrInsertComputed and the WeakMap equivalents.
// The `lib: []` case in bun-types.test.ts checks these without lib.esnext.collection.d.ts,
// and fixture/core-js-types.ts checks that the declarations match that lib file.
{
  const counts = new Map<string, number>();

  expectType(counts.getOrInsert("a", 1)).is<number>();
  expectType(counts.getOrInsertComputed("a", key => key.length)).is<number>();

  counts.getOrInsertComputed("a", key => {
    expectType(key).is<string>();
    return key.length;
  });

  // @ts-expect-error the default value must be a V
  counts.getOrInsert("a", "one");
  // @ts-expect-error the callback must return a V
  counts.getOrInsertComputed("a", () => "one");
  // @ts-expect-error the key must be a K
  counts.getOrInsert(1, 1);
}

{
  const themes = new WeakMap<object, string>();
  const key = {};

  expectType(themes.getOrInsert(key, "light")).is<string>();
  expectType(themes.getOrInsertComputed(key, k => String(k))).is<string>();

  themes.getOrInsertComputed(key, k => {
    expectType(k).is<object>();
    return "dark";
  });

  // @ts-expect-error the default value must be a V
  themes.getOrInsert(key, 1);
  // @ts-expect-error the callback must return a V
  themes.getOrInsertComputed(key, () => 1);
  // @ts-expect-error the key must be a K
  themes.getOrInsert("key", "light");
}

export {};
