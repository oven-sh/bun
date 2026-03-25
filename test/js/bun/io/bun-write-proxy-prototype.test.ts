import { expect, test } from "bun:test";
import { tempDir } from "harness";
import path from "path";

test("Bun.write with proxy-prototyped constructor does not crash", async () => {
  using dir = tempDir("bun-write-proxy", {});
  const origProto = Object.getPrototypeOf(Buffer);
  try {
    Object.setPrototypeOf(
      Buffer,
      new Proxy(origProto, {
        get(target, key, receiver) {
          try {
            void Reflect.has(target, key);
          } catch (_) {}
          return Reflect.get(target, key, receiver);
        },
      }),
    );
    // Buffer is a constructor (InternalFunction). Writing it as data should
    // convert via toString(), not crash.
    const result = await Bun.write(path.join(String(dir), "out.txt"), Buffer);
    expect(result).toBeGreaterThan(0);
  } finally {
    Object.setPrototypeOf(Buffer, origProto);
  }
});
