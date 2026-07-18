import { expect, test } from "bun:test";
import { isASAN } from "harness";

const asanIsSlowMultiplier = isASAN ? 0.2 : 1;
const count = Math.floor(10000 * asanIsSlowMultiplier);

// 10k fresh module records + a Bun.gc(true) on the whole-suite heap is seconds
// of work when every test shares one process — give both loops real headroom.
const IMPORT_HEAVY_TIMEOUT = 60_000;

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
  IMPORT_HEAVY_TIMEOUT,
);

test(
  `load the same empty JS file ${count} times`,
  async () => {
    const prev = Bun.unsafe.gcAggressionLevel();
    Bun.unsafe.gcAggressionLevel(0);
    for (let i = 0; i < count; i++) {
      const { default: obj } = await import("./load-same-empty-js-file-a-lot.js?i=" + i);
      expect(obj).toEqual({});
    }
    Bun.gc(true);
    Bun.unsafe.gcAggressionLevel(prev);
  },
  IMPORT_HEAVY_TIMEOUT,
);
