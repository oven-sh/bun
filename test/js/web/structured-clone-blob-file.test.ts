import { deserialize, serialize } from "bun:jsc";
import { describe, expect, test } from "bun:test";

describe("structuredClone with Blob and File", () => {
  describe("Blob structured clone", () => {
    test("empty Blob", () => {
      const blob = new Blob([]);
      const cloned = structuredClone(blob);
      expect(cloned).toBeInstanceOf(Blob);
      expect(cloned.size).toBe(0);
      expect(cloned.type).toBe("");
    });

    test("Blob with text content", async () => {
      const blob = new Blob(["hello world"], { type: "text/plain" });
      const cloned = structuredClone(blob);
      expect(cloned).toBeInstanceOf(Blob);
      expect(cloned.size).toBe(11);
      expect(cloned.type).toBe("text/plain;charset=utf-8");

      const originalText = await blob.text();
      const clonedText = await cloned.text();
      expect(clonedText).toBe(originalText);
    });

    test("Blob with binary content", async () => {
      const buffer = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello"
      const blob = new Blob([buffer], { type: "application/octet-stream" });
      const cloned = structuredClone(blob);
      expect(cloned).toBeInstanceOf(Blob);
      expect(cloned.size).toBe(5);
      expect(cloned.type).toBe("application/octet-stream");

      const originalBuffer = await blob.arrayBuffer();
      const clonedBuffer = await cloned.arrayBuffer();
      expect(new Uint8Array(clonedBuffer)).toEqual(new Uint8Array(originalBuffer));
    });

    test("nested Blob in object", () => {
      const blob = new Blob(["test"], { type: "text/plain" });
      const obj = { blob: blob };
      const cloned = structuredClone(obj);
      expect(cloned).toBeInstanceOf(Object);
      expect(cloned.blob).toBeInstanceOf(Blob);
      expect(cloned.blob.size).toBe(blob.size);
      expect(cloned.blob.type).toBe(blob.type);
    });

    test("nested Blob in array", () => {
      const blob = new Blob(["test"], { type: "text/plain" });
      const arr = [blob];
      const cloned = structuredClone(arr);
      expect(cloned).toBeInstanceOf(Array);
      expect(cloned[0]).toBeInstanceOf(Blob);
      expect(cloned[0].size).toBe(blob.size);
      expect(cloned[0].type).toBe(blob.type);
    });

    test("multiple Blobs in object", () => {
      const blob1 = new Blob(["hello"], { type: "text/plain" });
      const blob2 = new Blob(["world"], { type: "text/html" });
      const obj = { first: blob1, second: blob2 };
      const cloned = structuredClone(obj);

      expect(cloned.first).toBeInstanceOf(Blob);
      expect(cloned.first.size).toBe(5);
      expect(cloned.first.type).toBe("text/plain;charset=utf-8");

      expect(cloned.second).toBeInstanceOf(Blob);
      expect(cloned.second.size).toBe(5);
      expect(cloned.second.type).toBe("text/html;charset=utf-8");
    });

    test("deeply nested Blob", () => {
      const blob = new Blob(["deep"], { type: "text/plain" });
      const obj = { level1: { level2: { level3: { blob: blob } } } };
      const cloned = structuredClone(obj);

      expect(cloned.level1.level2.level3.blob).toBeInstanceOf(Blob);
      expect(cloned.level1.level2.level3.blob.size).toBe(blob.size);
      expect(cloned.level1.level2.level3.blob.type).toBe(blob.type);
    });
  });

  describe("File structured clone", () => {
    test("File with basic properties", () => {
      const file = new File(["content"], "test.txt", {
        type: "text/plain",
        lastModified: 1234567890000,
      });
      const cloned = structuredClone(file);

      expect(cloned).toBeInstanceOf(File);
      expect(cloned.name).toBe("test.txt");
      expect(cloned.size).toBe(7);
      expect(cloned.type).toBe("text/plain;charset=utf-8");
      expect(cloned.lastModified).toBe(1234567890000);
    });

    test("File without lastModified", () => {
      const file = new File(["content"], "test.txt", { type: "text/plain" });
      const cloned = structuredClone(file);

      expect(cloned).toBeInstanceOf(File);
      expect(cloned.name).toBe("test.txt");
      expect(cloned.size).toBe(7);
      expect(cloned.type).toBe("text/plain;charset=utf-8");
      expect(cloned.lastModified).toBeGreaterThan(0);
    });

    test("empty File", () => {
      const file = new File([], "empty.txt");
      const cloned = structuredClone(file);

      expect(cloned).toBeInstanceOf(File);
      expect(cloned.name).toBe("empty.txt");
      expect(cloned.size).toBe(0);
      expect(cloned.type).toBe("");
    });

    test("nested File in object", () => {
      const file = new File(["test"], "test.txt", { type: "text/plain" });
      const obj = { file: file };
      const cloned = structuredClone(obj);

      expect(cloned.file).toBeInstanceOf(File);
      expect(cloned.file.name).toBe("test.txt");
      expect(cloned.file.size).toBe(4);
      expect(cloned.file.type).toBe("text/plain;charset=utf-8");
    });

    test("multiple Files in object", () => {
      const file1 = new File(["hello"], "hello.txt", { type: "text/plain" });
      const file2 = new File(["world"], "world.html", { type: "text/html" });
      const obj = { txt: file1, html: file2 };
      const cloned = structuredClone(obj);

      expect(cloned.txt).toBeInstanceOf(File);
      expect(cloned.txt.name).toBe("hello.txt");
      expect(cloned.txt.type).toBe("text/plain;charset=utf-8");

      expect(cloned.html).toBeInstanceOf(File);
      expect(cloned.html.name).toBe("world.html");
      expect(cloned.html.type).toBe("text/html;charset=utf-8");
    });
  });

  describe("Mixed Blob and File structured clone", () => {
    test("Blob and File together", () => {
      const blob = new Blob(["blob content"], { type: "text/plain" });
      const file = new File(["file content"], "test.txt", { type: "text/plain" });
      const obj = { blob: blob, file: file };
      const cloned = structuredClone(obj);

      expect(cloned.blob).toBeInstanceOf(Blob);
      expect(cloned.blob.size).toBe(12);
      expect(cloned.blob.type).toBe("text/plain;charset=utf-8");

      expect(cloned.file).toBeInstanceOf(File);
      expect(cloned.file.name).toBe("test.txt");
      expect(cloned.file.size).toBe(12);
      expect(cloned.file.type).toBe("text/plain;charset=utf-8");
    });

    test("array with mixed Blob and File", () => {
      const blob = new Blob(["blob"], { type: "text/plain" });
      const file = new File(["file"], "test.txt", { type: "text/plain" });
      const arr = [blob, file];
      const cloned = structuredClone(arr);

      expect(cloned).toBeInstanceOf(Array);
      expect(cloned.length).toBe(2);

      expect(cloned[0]).toBeInstanceOf(Blob);
      expect(cloned[0].size).toBe(4);

      expect(cloned[1]).toBeInstanceOf(File);
      expect(cloned[1].name).toBe("test.txt");
      expect(cloned[1].size).toBe(4);
    });

    test("complex nested structure with Blobs and Files", () => {
      const blob = new Blob(["blob data"], { type: "text/plain" });
      const file = new File(["file data"], "data.txt", { type: "text/plain" });
      const complex = {
        metadata: { timestamp: Date.now() },
        content: {
          blob: blob,
          files: [file, new File(["another"], "other.txt")],
        },
      };
      const cloned = structuredClone(complex);

      expect(cloned.metadata.timestamp).toBe(complex.metadata.timestamp);
      expect(cloned.content.blob).toBeInstanceOf(Blob);
      expect(cloned.content.blob.size).toBe(9);
      expect(cloned.content.files).toBeInstanceOf(Array);
      expect(cloned.content.files[0]).toBeInstanceOf(File);
      expect(cloned.content.files[0].name).toBe("data.txt");
      expect(cloned.content.files[1].name).toBe("other.txt");
    });
  });

  describe("Edge cases with empty data", () => {
    test("Blob with empty data", () => {
      const blob = new Blob([]);
      const cloned = structuredClone(blob);

      expect(cloned).toBeInstanceOf(Blob);
      expect(cloned.size).toBe(0);
      expect(cloned.type).toBe("");
    });

    test("nested Blob with empty data in object", () => {
      const blob = new Blob([]);
      const obj = { emptyBlob: blob };
      const cloned = structuredClone(obj);

      expect(cloned.emptyBlob).toBeInstanceOf(Blob);
      expect(cloned.emptyBlob.size).toBe(0);
      expect(cloned.emptyBlob.type).toBe("");
    });

    test("File with empty data", () => {
      const file = new File([], "empty.txt");
      const cloned = structuredClone(file);

      expect(cloned).toBeInstanceOf(File);
      expect(cloned.name).toBe("empty.txt");
      expect(cloned.size).toBe(0);
      expect(cloned.type).toBe("");
    });

    test("nested File with empty data in object", () => {
      const file = new File([], "empty.txt");
      const obj = { emptyFile: file };
      const cloned = structuredClone(obj);

      expect(cloned.emptyFile).toBeInstanceOf(File);
      expect(cloned.emptyFile.name).toBe("empty.txt");
      expect(cloned.emptyFile.size).toBe(0);
      expect(cloned.emptyFile.type).toBe("");
    });

    test("File with empty data and empty name", () => {
      const file = new File([], "");
      const cloned = structuredClone(file);

      expect(cloned).toBeInstanceOf(File);
      expect(cloned.name).toBe("");
      expect(cloned.size).toBe(0);
      expect(cloned.type).toBe("");
    });

    test("nested File with empty data and empty name in object", () => {
      const file = new File([], "");
      const obj = { emptyFile: file };
      const cloned = structuredClone(obj);

      expect(cloned.emptyFile).toBeInstanceOf(File);
      expect(cloned.emptyFile.name).toBe("");
      expect(cloned.emptyFile.size).toBe(0);
      expect(cloned.emptyFile.type).toBe("");
    });
  });

  describe("Regression tests for issue 20596", () => {
    test("original issue case - object with File and Blob", () => {
      const clone = structuredClone({
        file: new File([], "example.txt"),
        blob: new Blob([]),
      });

      expect(clone).toHaveProperty("file");
      expect(clone).toHaveProperty("blob");
      expect(clone.file).toBeInstanceOf(File);
      expect(clone.blob).toBeInstanceOf(Blob);
      expect(clone.file.name).toBe("example.txt");
    });

    test("single nested Blob should not throw", () => {
      const blob = new Blob(["test"]);
      const obj = { blob: blob };

      const cloned = structuredClone(obj);
      expect(cloned.blob).toBeInstanceOf(Blob);
    });

    test("single nested File should not throw", () => {
      const file = new File(["test"], "test.txt");
      const obj = { file: file };

      const cloned = structuredClone(obj);
      expect(cloned.file).toBeInstanceOf(File);
    });
  });

  describe("deserialize of crafted payloads", () => {
    // The Blob structured-clone wire format carries an `offset` (u64 LE) that
    // the sender controls. A malicious payload can set it past the end of the
    // serialized byte store; without clamping, reading the resulting Blob
    // (`arrayBuffer()`/`text()`/`bytes()`) slices past the backing allocation
    // and returns unrelated heap memory.
    //
    // These tests assert that out-of-range offsets are clamped to the store
    // bounds so no out-of-store bytes are ever exposed.

    function craft(offset: bigint) {
      // Use a recognizable marker for the store bytes so we can detect
      // whether any returned byte came from outside the store.
      const marker = 0xa5;
      const payload = Buffer.alloc(4, marker);
      const serialized = new Uint8Array(serialize(new Blob([payload])));

      // Locate the offset field by serializing a sliced blob with a sentinel
      // offset and diffing; this keeps the test robust against wire-format
      // header changes.
      const sentinel = new Uint8Array(serialize(new Blob([Buffer.alloc(8, marker)]).slice(4)));
      let at = -1;
      for (let i = 0; i + 8 <= sentinel.length; i++) {
        if (
          sentinel[i] === 4 &&
          sentinel[i + 1] === 0 &&
          sentinel[i + 2] === 0 &&
          sentinel[i + 3] === 0 &&
          sentinel[i + 4] === 0 &&
          sentinel[i + 5] === 0 &&
          sentinel[i + 6] === 0 &&
          sentinel[i + 7] === 0 &&
          serialized[i] === 0
        ) {
          at = i;
          break;
        }
      }
      if (at < 0) throw new Error("could not locate offset field in serialized blob");

      const view = new DataView(serialized.buffer, serialized.byteOffset, serialized.byteLength);
      view.setBigUint64(at, offset, true);
      return { serialized, marker };
    }

    test.each([
      ["just past end", 5n],
      ["small", 64n],
      ["page", 4096n],
      ["1 MiB", 1024n * 1024n],
      ["2^40", 1n << 40n],
      ["> u52", (1n << 52n) + 123n],
      ["u64 max", (1n << 64n) - 1n],
    ])("offset %s does not expose out-of-store bytes", async (_name, offset) => {
      const { serialized, marker } = craft(offset);
      const blob = deserialize(serialized);
      expect(blob).toBeInstanceOf(Blob);

      const bytes = new Uint8Array(await blob.arrayBuffer());
      // Every returned byte must have come from the 4-byte store. With the
      // crafted offset >= store length, the only in-bounds result is empty.
      expect(bytes.byteLength).toBe(0);
      for (const b of bytes) expect(b).toBe(marker);

      // Other readers go through the same sharedView() path.
      expect(await blob.text()).toBe("");
      expect((await blob.bytes()).byteLength).toBe(0);
    });

    test("offset equal to store length yields empty view", async () => {
      const { serialized } = craft(4n);
      const blob = deserialize(serialized);
      expect(new Uint8Array(await blob.arrayBuffer()).byteLength).toBe(0);
    });

    test("node:v8 deserialize is equally bounded", async () => {
      const v8 = require("node:v8");
      const { serialized } = craft(1n << 20n);
      const blob = v8.deserialize(Buffer.from(serialized));
      expect(blob).toBeInstanceOf(Blob);
      expect((await blob.arrayBuffer()).byteLength).toBe(0);
    });
  });
});
