import { deserialize, serialize } from "bun:jsc";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import v8 from "node:v8";

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
    // and returns unrelated heap memory (or segfaults on an unmapped page).
    //
    // These tests assert that out-of-range offsets are clamped to the store
    // bounds so no out-of-store bytes are ever exposed. The work runs in a
    // child process so that the pre-fix crash surfaces as an ordinary test
    // failure instead of killing the test runner.

    // Locate the offset field once. Do it by serializing a sliced blob with a
    // sentinel offset and comparing against a zero-offset payload; keeps the
    // test robust against wire-format header changes.
    const marker = 0xa5;
    const baseline = new Uint8Array(serialize(new Blob([Buffer.alloc(4, marker)])));
    const sentinel = new Uint8Array(serialize(new Blob([Buffer.alloc(8, marker)]).slice(4)));
    let offsetFieldIndex = -1;
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
        baseline[i] === 0
      ) {
        offsetFieldIndex = i;
        break;
      }
    }
    if (offsetFieldIndex < 0) throw new Error("could not locate offset field in serialized blob");

    function craft(offset: bigint) {
      const serialized = new Uint8Array(serialize(new Blob([Buffer.alloc(4, marker)])));
      const view = new DataView(serialized.buffer, serialized.byteOffset, serialized.byteLength);
      view.setBigUint64(offsetFieldIndex, offset, true);
      return serialized;
    }

    // Child script: receives (offsetFieldIndex, offset) on argv, rebuilds the
    // crafted payload, deserializes, reads every body-mixin path, and prints a
    // JSON summary. On a vulnerable build this either prints a non-zero length
    // (OOB heap bytes) or the process dies before printing anything.
    const childScript = `
      const { serialize, deserialize } = require("bun:jsc");
      const v8 = require("node:v8");
      const [, atStr, offsetStr] = process.argv;
      const at = Number(atStr);
      const offset = BigInt(offsetStr);
      const serialized = new Uint8Array(serialize(new Blob([Buffer.alloc(4, 0xa5)])));
      new DataView(serialized.buffer, serialized.byteOffset, serialized.byteLength).setBigUint64(at, offset, true);

      for (const de of [deserialize, buf => v8.deserialize(Buffer.from(buf))]) {
        const blob = de(serialized);
        const ab = new Uint8Array(await blob.arrayBuffer());
        const bytes = await blob.bytes();
        const text = await blob.text();
        const all5 = ab.every(b => b === 0xa5);
        process.stdout.write(JSON.stringify({ len: ab.byteLength, bytesLen: bytes.byteLength, textLen: text.length, all5 }) + "\\n");
      }
    `;

    test.each([
      ["just past end", 5n],
      ["small", 64n],
      ["page", 4096n],
      ["1 MiB", 1024n * 1024n],
      ["2^40", 1n << 40n],
      ["> u52", (1n << 52n) + 123n],
      ["u64 max", (1n << 64n) - 1n],
    ])(
      "offset %s does not expose out-of-store bytes",
      async (_name, offset) => {
        await using proc = Bun.spawn({
          cmd: [bunExe(), "-e", childScript, String(offsetFieldIndex), String(offset)],
          env: bunEnv,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

        // offset >= store length, so the only in-bounds result is an empty view
        // from every reader on both deserialize entry points.
        const expected = { len: 0, bytesLen: 0, textLen: 0, all5: true };
        expect(
          stdout
            .split("\n")
            .filter(Boolean)
            .map(l => JSON.parse(l)),
        ).toEqual([expected, expected]);
        expect(stderr).toBe("");
        expect(exitCode).toBe(0);
      },
      30_000,
    );

    test("in-process: offset at store boundary yields empty view", async () => {
      // offset == store length stays within the allocation on any build, so
      // this is safe to assert in-process and covers the boundary directly.
      const blob = deserialize(craft(4n));
      expect(blob).toBeInstanceOf(Blob);
      expect((await blob.arrayBuffer()).byteLength).toBe(0);
      expect((await blob.bytes()).byteLength).toBe(0);
      expect(await blob.text()).toBe("");

      const viaV8 = v8.deserialize(Buffer.from(craft(4n)));
      expect((await viaV8.arrayBuffer()).byteLength).toBe(0);
    });
  });
});
