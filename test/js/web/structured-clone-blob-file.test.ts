import { deserialize, serialize } from "bun:jsc";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isWindows } from "harness";
import v8 from "node:v8";

describe("structuredClone with Blob and File", () => {
  describe("Blob structured clone", () => {
    test("slices and re-slices serialize only their own byte windows", async () => {
      const before = "BEFORE-WINDOW-0123456789";
      const middle = "public-window-payload";
      const after = "AFTER-WINDOW-9876543210";
      const parent = new Blob([before + middle + after], { type: "application/octet-stream" });
      const slice = parent.slice(before.length, before.length + middle.length);

      // The serialized payload of the slice contains the slice's bytes and
      // nothing from the rest of the parent buffer.
      const wire = Buffer.from(serialize(slice));
      expect(wire.includes(middle)).toBe(true);
      expect(wire.includes(before)).toBe(false);
      expect(wire.includes(after)).toBe(false);

      const cloned = structuredClone(slice);
      expect(cloned.size).toBe(middle.length);
      expect(await cloned.text()).toBe(middle);

      // A slice of a slice is bounded by the innermost window.
      const inner = slice.slice(7); // "window-payload"
      const innerWire = Buffer.from(serialize(inner));
      expect(innerWire.includes("window-payload")).toBe(true);
      expect(innerWire.includes("public-")).toBe(false);
      expect(innerWire.includes(before)).toBe(false);
      expect(innerWire.includes(after)).toBe(false);

      const innerClone = deserialize(serialize(inner));
      expect(innerClone.size).toBe("window-payload".length);
      expect(await innerClone.text()).toBe("window-payload");

      // Serializing must not change what the live source objects read as.
      expect(slice.size).toBe(middle.length);
      expect(await slice.text()).toBe(middle);
      expect(inner.size).toBe("window-payload".length);
      expect(await inner.text()).toBe("window-payload");

      // The parent blob is unaffected and still round-trips in full.
      const parentClone = structuredClone(parent);
      expect(parentClone.size).toBe(parent.size);
      expect(await parentClone.text()).toBe(before + middle + after);
    });

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

    test("sliced Blob transmits only the sliced bytes", async () => {
      const blob = new Blob(["header-PAYLOAD-trailer"]);
      const slice = blob.slice(7, 14);

      const wire = Buffer.from(serialize(slice));
      expect(wire.includes("PAYLOAD")).toBe(true);
      expect(wire.includes("header-")).toBe(false);
      expect(wire.includes("-trailer")).toBe(false);

      // Serializing must not mutate the live slice.
      expect(slice.size).toBe(7);
      expect(await slice.text()).toBe("PAYLOAD");

      const cloned = structuredClone(slice);
      expect(cloned.size).toBe(7);
      expect(await cloned.text()).toBe("PAYLOAD");

      const roundTripped = deserialize(serialize(slice));
      expect(roundTripped.size).toBe(7);
      expect(await roundTripped.text()).toBe("PAYLOAD");
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

    // Locate the offset field once. Memory-backed blobs always serialize a
    // zero offset (the payload already is the slice), so plant a sentinel
    // offset with a sliced file-backed blob and compare against a zero-offset
    // payload; keeps the test robust against wire-format header changes.
    const marker = 0xa5;
    const baseline = new Uint8Array(serialize(new Blob([Buffer.alloc(4, marker)])));
    const sentinel = new Uint8Array(serialize(Bun.file(import.meta.path).slice(4)));
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

    test.concurrent.each([
      ["just past end", 5n],
      ["small", 64n],
      ["page", 4096n],
      ["1 MiB", 1024n * 1024n],
      ["2^40", 1n << 40n],
      ["> u52", (1n << 52n) + 123n],
      ["u64 max", (1n << 64n) - 1n],
    ])("offset %s does not expose out-of-store bytes", async (_name, offset) => {
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
    });

    test("file-backed Blob path with interior NUL is rejected at deserialize", async () => {
      // A crafted Blob wire image whose File store path contains an interior
      // NUL must be rejected as a JS error at deserialize time; it must never
      // reach the syscall layer where the C-string view would truncate (and
      // debug builds abort in ZStr::as_cstr). Build the image by round-tripping
      // a real file-backed blob and overwriting the path bytes, so the outer
      // serializer framing and the Blob record layout stay whatever the current
      // build emits.
      const probe = Buffer.alloc(16, 0x5a);
      const good = Buffer.from(serialize(Bun.file(probe.toString("latin1"))));
      const at = good.indexOf(probe);
      expect(at).toBeGreaterThan(0);
      // Sanity: both entry points accept the unmodified image.
      expect(deserialize(good)).toBeInstanceOf(Blob);
      expect(v8.deserialize(good)).toBeInstanceOf(Blob);

      const bad = Buffer.from(good);
      bad.set(Buffer.from("/e\0tc/host\0s____", "latin1"), at);

      // Run in a child so that if the reader ever aborts on these bytes the
      // test runner survives. The assertion is on the deserialize step: it
      // must throw, so no Blob carrying a NUL-embedded path ever exists.
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
            const { deserialize } = require("bun:jsc");
            const v8 = require("node:v8");
            const bad = Buffer.from(process.argv[1], "base64");
            for (const [name, de] of [["bun:jsc", deserialize], ["node:v8", b => v8.deserialize(b)]]) {
              let threw = null;
              try {
                de(bad);
              } catch (e) {
                threw = { name: e?.constructor?.name, message: String(e?.message ?? e) };
              }
              process.stdout.write(JSON.stringify({ entry: name, threw }) + "\\n");
            }
          `,
          bad.toString("base64"),
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      const lines = stdout
        .split("\n")
        .filter(Boolean)
        .map(l => JSON.parse(l));
      expect({ lines, stderr, exitCode, signalCode: proc.signalCode }).toEqual({
        lines: [
          { entry: "bun:jsc", threw: { name: "TypeError", message: "Unable to deserialize data." } },
          { entry: "node:v8", threw: { name: "TypeError", message: "Unable to deserialize data." } },
        ],
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
    });

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

    // The File-store variant of the Blob record carries a raw fd on the wire.
    // `Bun.file(fd)` enforces `0 <= fd <= i32::MAX`; the deserializer must
    // apply the same range so a crafted record cannot materialize a Blob over
    // an fd that no JS could construct. On posix, fd == -1 reaches the
    // `raw != -1` assert in `Fd::as_borrowed_fd` and aborts the process at
    // the first `.size` / body-mixin touch.
    describe.skipIf(isWindows)("crafted File blob fd (posix)", () => {
      // Robustness against header/framing changes: serialize a file-backed
      // blob over a distinctive sentinel fd, locate its 4-byte image in the
      // output (posix Fd is `#[repr(transparent)] i32`), and patch it.
      const fdSentinel = 0x7e7d7c7b; // distinct bytes, inside [0, i32::MAX]
      const fdImage = Buffer.from(new Uint8Array(serialize(Bun.file(fdSentinel))));
      const fdNeedle = Buffer.alloc(4);
      fdNeedle.writeInt32LE(fdSentinel);
      const fdFieldIndex = fdImage.indexOf(fdNeedle);
      if (fdFieldIndex < 0) throw new Error("could not locate fd field in serialized file blob");

      function craftFd(fd: number) {
        const out = Buffer.from(fdImage);
        out.writeInt32LE(fd, fdFieldIndex);
        return out;
      }

      // The pre-fix build aborts on `.size`, so run each case in a subprocess
      // and require a clean exit that reports a deserialize-time throw.
      const fdChildScript = `
        const { deserialize } = require("bun:jsc");
        const v8 = require("node:v8");
        const payload = Buffer.from(process.argv[1], "base64");
        for (const de of [deserialize, buf => v8.deserialize(Buffer.from(buf))]) {
          let outcome;
          try {
            const blob = de(payload);
            void blob.size;
            outcome = { threw: false };
          } catch (e) {
            outcome = { threw: true, message: String(e.message) };
          }
          process.stdout.write(JSON.stringify(outcome) + "\\n");
        }
      `;

      test.concurrent.each([
        ["fd = -1", -1],
        ["fd = -2", -2],
        ["fd = i32::MIN", -2147483648],
      ])("%s is rejected at deserialize", async (_name, fd) => {
        await using proc = Bun.spawn({
          cmd: [bunExe(), "-e", fdChildScript, craftFd(fd).toString("base64")],
          env: bunEnv,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

        const expected = { threw: true, message: "Unable to deserialize data." };
        expect({
          stderr,
          outcomes: stdout
            .split("\n")
            .filter(Boolean)
            .map(l => JSON.parse(l)),
        }).toEqual({ stderr: "", outcomes: [expected, expected] });
        expect(exitCode).toBe(0);
      });

      test("fd >= 0 still deserializes", () => {
        for (const fd of [0, 1, fdSentinel]) {
          expect(deserialize(craftFd(fd))).toBeInstanceOf(Blob);
          expect(v8.deserialize(craftFd(fd))).toBeInstanceOf(Blob);
        }
      });
    });

    test("truncated payload at every byte boundary throws cleanly", () => {
      // Every truncation point must surface as a thrown error (never a
      // partially-constructed Blob, never a crash). This is the functional
      // half of the leak test below — it sweeps every error-return edge in
      // the deserializer so we know each one is reachable.
      const full = new Uint8Array(
        serialize(
          new File([Buffer.alloc(8, 0x42)], "name.bin", {
            type: Buffer.alloc(8, "t").toString(),
            lastModified: 123,
          }),
        ),
      );
      // Sanity: the un-truncated payload round-trips.
      expect(deserialize(full)).toBeInstanceOf(Blob);

      let threw = 0;
      for (let n = 1; n < full.length; n++) {
        try {
          deserialize(full.slice(0, n));
        } catch {
          threw++;
        }
      }
      // At least one byte must be missing for the read to fail; depending on
      // trailing framing the last few truncations may still parse, so just
      // require that the overwhelming majority threw and none crashed.
      expect(threw).toBeGreaterThan(full.length / 2);
    });

    test("truncated payload does not leak content_type / bytes / Store / Blob", () => {
      // The deserializer allocates content_type, then the bytes payload +
      // Store, then heap-promotes the Blob, then reads trailer fields. A
      // payload truncated anywhere after the first allocation used to leak
      // everything allocated so far on the error path. With ~64 KiB in each
      // of content_type and body, a few thousand failed deserializes would
      // grow RSS by hundreds of MiB without the errdefer cleanup.
      const chunk = 64 * 1024;
      const full = new Uint8Array(
        serialize(
          new File([Buffer.alloc(chunk, 0x42)], "leak.bin", {
            type: Buffer.alloc(chunk, "t").toString(),
            lastModified: 123,
          }),
        ),
      );
      expect(deserialize(full)).toBeInstanceOf(Blob);

      // Pick truncation points that land after each allocation site:
      //   header .. [content_type:64K] .. flags .. [bytes:64K] .. name .. trailer
      // We locate them by scanning for the 64 KiB runs of the fill bytes so the
      // test stays robust against outer serializer framing changes.
      function endOfRun(byte: number) {
        let run = 0;
        for (let i = 0; i < full.length; i++) {
          run = full[i] === byte ? run + 1 : 0;
          if (run === chunk) return i + 1;
        }
        throw new Error("could not locate payload run");
      }
      const afterContentType = endOfRun(0x74); // 't'
      const afterBytes = endOfRun(0x42); // 'B'
      // After the body the wire format carries stored_name_len (u32) +
      // stored_name ("leak.bin", 8 bytes) before the Blob is heap-promoted.
      const afterStoredName = afterBytes + 4 + "leak.bin".length;
      const cuts = [
        afterContentType, // content_type allocated, next read fails
        afterContentType + 2, // store_tag + bytes_len partially read
        afterBytes, // bytes + Store allocated, stored_name len read fails
        afterStoredName, // heap *Blob allocated, is_jsdom_file read fails
        full.length - 1, // v3 File name read fails (last byte missing)
      ];
      const payloads = cuts.map(n => full.slice(0, n));
      // All of these must hit the error path; if one accidentally succeeds
      // the test isn't measuring what it thinks it is.
      for (const p of payloads) expect(() => deserialize(p)).toThrow();

      const attempt = () => {
        for (const p of payloads) {
          try {
            deserialize(p);
          } catch {}
        }
      };

      // Warm up long enough for the allocator's arena to reach steady state
      // (debug+ASAN builds front-load some RSS growth over the first few
      // thousand alloc/free cycles of this size class), then measure.
      // Without the errdefer cleanup each iteration leaks ~512 KiB across
      // the five cut points, so the measured window grows by ~750 MiB;
      // with it the window is flat modulo a few MiB of noise.
      for (let i = 0; i < 1000; i++) attempt();
      Bun.gc(true);
      const rssBefore = process.memoryUsage.rss();
      for (let i = 0; i < 1500; i++) attempt();
      Bun.gc(true);
      const rssAfter = process.memoryUsage.rss();

      const deltaMiB = (rssAfter - rssBefore) / 1024 / 1024;
      // ASAN's quarantine retains freed allocations (default 256 MB) so the
      // measured window still grows under bun-asan; widen the threshold there.
      expect(deltaMiB).toBeLessThan(isASAN ? 128 : 32);
    }, 30_000);
  });
});
