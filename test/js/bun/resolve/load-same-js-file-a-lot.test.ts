import { expect, test } from "bun:test";

test("load the same file 10,000 times", async () => {
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
  for (let i = 0; i < 10000; i++) {
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
});

test("load the same empty JS file 10,000 times", async () => {
  const prev = Bun.unsafe.gcAggressionLevel();
  Bun.unsafe.gcAggressionLevel(0);
  for (let i = 0; i < 10000; i++) {
    const { default: obj } = await import("./load-same-empty-js-file-a-lot.js?i=" + i);
    expect(obj).toEqual({});
  }
  Bun.gc(true);
  Bun.unsafe.gcAggressionLevel(prev);
});
