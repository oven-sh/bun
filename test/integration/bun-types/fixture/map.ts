import { expectType } from "./utilities";

// https://github.com/oven-sh/bun/issues/27380
// Map.prototype.getOrInsert / Map.prototype.getOrInsertComputed
// WeakMap.prototype.getOrInsert / WeakMap.prototype.getOrInsertComputed

{
  const options = new Map<string, number>();

  expectType(options.getOrInsert("a", 1)).is<number>();
  expectType(options.getOrInsertComputed("a", key => key.length)).is<number>();

  options.getOrInsertComputed("a", key => {
    expectType(key).is<string>();
    return key.length;
  });

  // @ts-expect-error - value type must match V
  options.getOrInsert("a", "not-a-number");

  // @ts-expect-error - callback return type must match V
  options.getOrInsertComputed("a", () => "not-a-number");
}

{
  const weak = new WeakMap<object, string>();
  const key = {};

  expectType(weak.getOrInsert(key, "light")).is<string>();
  expectType(weak.getOrInsertComputed(key, k => String(k))).is<string>();

  weak.getOrInsertComputed(key, k => {
    expectType(k).is<object>();
    return "dark";
  });

  // @ts-expect-error - value type must match V
  weak.getOrInsert(key, 123);

  // @ts-expect-error - callback return type must match V
  weak.getOrInsertComputed(key, () => 123);
}

export {};
