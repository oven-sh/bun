import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { join } from "path";

describe("Bun.write() with ReadableStream", () => {
  test("ReadableStream type is accepted by TypeScript", async () => {
    using tmpdir = tempDir("readablestream-types", {});
    const testFile = join(tmpdir, "test.txt");

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("Hello"));
        controller.close();
      },
    });

    // These should all compile without TypeScript errors
    // Note: Currently ReadableStream is converted to string "[object ReadableStream]"
    // This test documents the type support, not the runtime behavior
    const result = await Bun.write(testFile, stream);
    expect(typeof result).toBe("number");
  });

  test("BunFile.write() accepts ReadableStream type", async () => {
    using tmpdir = tempDir("readablestream-file-types", {});
    const testFile = join(tmpdir, "test.txt");

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("World"));
        controller.close();
      },
    });

    const file = Bun.file(testFile);
    const result = await file.write(stream);
    expect(typeof result).toBe("number");
  });

  test("Bun.write() accepts ReadableStream in first overload", async () => {
    using tmpdir = tempDir("readablestream-overload", {});

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("test"));
        controller.close();
      },
    });

    // Test all three forms
    await Bun.write(join(tmpdir, "test1.txt"), stream);
    await Bun.write(Bun.file(join(tmpdir, "test2.txt")), stream);

    const stream2 = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("test"));
        controller.close();
      },
    });
    await Bun.file(join(tmpdir, "test3.txt")).write(stream2);
  });
});
