import { expect, test } from "bun:test";
import { isASAN, isDebug } from "harness";

const asanIsSlowMultiplier = isASAN ? 0.2 : 1;
const count = Math.floor(10000 * asanIsSlowMultiplier);

test(
  `load the same file ${count} times`,
  async () => {
    const meta = {
      url: import.meta.url.toLocaleLowerCase().replace(".test.ts", ".js"),
      dir: import.meta.dir.toLocaleLowerCase().replace(".test.ts", ".js"),
      file: import.meta.file.toLocaleLowerCase().replace(".test.ts", ".js"),
      path: import.meta.path.toLocaleLowerCase().replace(".test.ts", ".js"),
      dirname: import.meta.dirname.toLocaleLowerCase().replace(".test.ts", ".js"),
      filename: import.meta.filename.toLocaleLowerCase().replace(".test.ts", ".js"),
    };
    const prev = Bun.unsafe.gcAggressionLevel();
    Bun.unsafe.gcAggressionLevel(0);
    for (let i = 0; i < count; i++) {
      const {
        default: { url, dir, file, path, dirname, filename },
      } = await import("./load-same-js-file-a-lot.js?i=" + i);
      expect(url).toBe(meta.url + "?i=" + i);
      expect(dir).toBe(meta.dir);
      expect(file).toBe(meta.file);
      expect(path).toBe(meta.path);
      expect(dirname).toBe(meta.dirname);
      expect(filename).toBe(meta.filename);
    }
    Bun.gc(true);
    Bun.unsafe.gcAggressionLevel(prev);
  },
  isDebug || isASAN ? 20_000 : 5000,
);

test(`load the same empty JS file ${count} times`, async () => {
  const prev = Bun.unsafe.gcAggressionLevel();
  Bun.unsafe.gcAggressionLevel(0);
  for (let i = 0; i < count; i++) {
    const { default: obj } = await import("./load-same-empty-js-file-a-lot.js?i=" + i);
    expect(obj).toEqual({});
  }
  Bun.gc(true);
  Bun.unsafe.gcAggressionLevel(prev);
});
