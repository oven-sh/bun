// @bun
const { describe, expect, it, test } = Bun.jest(import.meta.path);

test("string no atomize should work", () => {
  var str = "hello";
  if (structuredClone(str) !== str) {
    throw new Error("FAIL");
  }

  var obj = {};
  for (var i = 0; i < 10000; i++) {
    obj[str] = str;
  }

  if (Object.getOwnPropertyNames(obj).length !== 1) {
    throw new Error("FAIL");
  }

  var obj2 = {};
  for (var i = 0; i < 10000; i++) {
    obj2[str] = Object.getOwnPropertyNames(obj)[0];
  }

  if (structuredClone(Object.getOwnPropertyNames(obj2)[0]) !== str) {
    throw new Error("FAIL");
  }
});
