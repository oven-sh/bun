import { setSyntheticAllocationLimitForTesting } from "bun:internal-for-testing";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "fs";
import { tempDirWithFiles } from "harness";
import path from "path";
describe("Memory", () => {
  beforeAll(() => {
    setSyntheticAllocationLimitForTesting(128 * 1024 * 1024);
  });
  afterEach(() => {
    Bun.gc(true);
  });

  describe("Blob", () => {
    let buf: ArrayBuffer;
    beforeAll(() => {
      buf = new ArrayBuffer(Math.floor(64 * 1024 * 1024));
    });

    test(".json() should throw an OOM without crashing the process.", () => {
      const array = [buf, buf, buf, buf, buf, buf, buf, buf, buf];
      expect(async () => await new Blob(array).json()).toThrow(
        "Cannot parse a JSON string longer than 2^32-1 characters",
      );
    });

    test(".text() should throw an OOM without crashing the process.", () => {
      const array = [buf, buf, buf, buf, buf, buf, buf, buf, buf];
      expect(async () => await new Blob(array).text()).toThrow("Cannot create a string longer than 2^32-1 characters");
    });

    test(".bytes() should throw an OOM without crashing the process.", () => {
      const array = [buf, buf, buf, buf, buf, buf, buf, buf, buf];
      expect(async () => await new Blob(array).bytes()).toThrow("Out of memory");
    });

    test(".arrayBuffer() should NOT throw an OOM.", () => {
      const array = [buf, buf, buf, buf, buf, buf, buf, buf, buf];
      expect(async () => await new Blob(array).arrayBuffer()).not.toThrow();
    });
  });

  describe("Response", () => {
    let blob: Blob;
    beforeAll(() => {
      const buf = new ArrayBuffer(Math.floor(64 * 1024 * 1024));
      blob = new Blob([buf, buf, buf, buf, buf, buf, buf, buf, buf]);
    });
    afterAll(() => {
      blob = undefined;
    });

    test(".text() should throw an OOM without crashing the process.", () => {
      expect(async () => await new Response(blob).text()).toThrow(
        "Cannot create a string longer than 2^32-1 characters",
      );
    });

    test(".bytes() should throw an OOM without crashing the process.", async () => {
      expect(async () => await new Response(blob).bytes()).toThrow("Out of memory");
    });

    test(".arrayBuffer() should NOT throw an OOM.", async () => {
      expect(async () => await new Response(blob).arrayBuffer()).not.toThrow();
    });

    test(".json() should throw an OOM without crashing the process.", async () => {
      expect(async () => await new Response(blob).json()).toThrow(
        "Cannot parse a JSON string longer than 2^32-1 characters",
      );
    });
  });

  describe("Request", () => {
    let blob: Blob;
    beforeAll(() => {
      const buf = new ArrayBuffer(Math.floor(64 * 1024 * 1024));
      blob = new Blob([buf, buf, buf, buf, buf, buf, buf, buf, buf]);
    });
    afterAll(() => {
      blob = undefined;
    });

    test(".text() should throw an OOM without crashing the process.", () => {
      expect(async () => await new Request("http://localhost:3000", { body: blob }).text()).toThrow(
        "Cannot create a string longer than 2^32-1 characters",
      );
    });

    test(".bytes() should throw an OOM without crashing the process.", async () => {
      expect(async () => await new Request("http://localhost:3000", { body: blob }).bytes()).toThrow("Out of memory");
    });

    test(".arrayBuffer() should NOT throw an OOM.", async () => {
      expect(async () => await new Request("http://localhost:3000", { body: blob }).arrayBuffer()).not.toThrow();
    });

    test(".json() should throw an OOM without crashing the process.", async () => {
      expect(async () => await new Request("http://localhost:3000", { body: blob }).json()).toThrow(
        "Cannot parse a JSON string longer than 2^32-1 characters",
      );
    });
  });
});

describe("Bun.file", () => {
  let tmpFile;
  beforeAll(async () => {
    const buf = Buffer.allocUnsafe(8 * 1024 * 1024);
    const tmpDir = tempDirWithFiles("file-oom", {
      "file.txt": buf,
    });
    tmpFile = path.join(tmpDir, "file.txt");
  });
  beforeEach(() => {
    setSyntheticAllocationLimitForTesting(4 * 1024 * 1024);
  });
  afterEach(() => {
    setSyntheticAllocationLimitForTesting(128 * 1024 * 1024);
  });
  afterAll(() => {
    try {
      unlinkSync(tmpFile);
    } catch (err) {
      console.error(err);
    }
  });

  test("text() should throw an OOM without crashing the process.", () => {
    expect(async () => await Bun.file(tmpFile).text()).toThrow();
  });

  test("bytes() should throw an OOM without crashing the process.", () => {
    expect(async () => await Bun.file(tmpFile).bytes()).toThrow();
  });

  test("json() should throw an OOM without crashing the process.", () => {
    expect(async () => await Bun.file(tmpFile).json()).toThrow();
  });

  test("arrayBuffer() should NOT throw an OOM.", () => {
    expect(async () => await Bun.file(tmpFile).arrayBuffer()).not.toThrow();
  });
});
