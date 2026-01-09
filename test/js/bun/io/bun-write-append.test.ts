import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { join } from "path";

describe.concurrent("Bun.write append tests", () => {
  test("Bun.write(file, string, { append: true }) appends to existing file", async () => {
    using tmp = tempDir("bun-write-append-existing", {});

    const file = Bun.file(join(tmp, "file.txt"));

    await Bun.write(file, "hello");
    await Bun.write(file, " bun", { append: true });

    expect(await file.text()).toBe("hello bun");
    expect(file.size).toBe(9);
  });

  test("Bun.write(file, string, { append: true }) creates file if it does not exist", async () => {
    using tmp = tempDir("bun-write-append-create", {});

    const file = Bun.file(join(tmp, "file.txt"));

    await Bun.write(file, "hello", { append: true });
    await Bun.write(file, " bun", { append: true });

    expect(await Bun.file(join(tmp, "file.txt")).text()).toBe("hello bun");
    expect(Bun.file(join(tmp, "file.txt")).size).toBe(9);
  });

  test("Bun.file().write(string, { append: true }) appends to existing file", async () => {
    using tmp = tempDir("bun-file-write-append-existing", {});

    const file = Bun.file(join(tmp, "file.txt"));

    await file.write("hello");
    await file.write(" bun", { append: true });

    expect(await file.text()).toBe("hello bun");
    expect(file.size).toBe(9);
  });

  test("Bun.file().write(string, { append: true }) creates file if it does not exist", async () => {
    using tmp = tempDir("bun-file-write-append-create", {});

    const file = Bun.file(join(tmp, "file.txt"));

    await file.write("hello", { append: true });
    await file.write(" bun", { append: true });

    expect(await file.text()).toBe("hello bun");
    expect(file.size).toBe(9);
  });

  test("Bun.write(file, file, { append: true }) appends to existing file", async () => {
    using tmp = tempDir("bun-write-file-append", {});
    const src = join(tmp, "src.txt");
    const dest = join(tmp, "dest.txt");
    await Bun.write(src, " bun");
    await Bun.write(dest, "hello");

    await Bun.write(dest, Bun.file(src), { append: true });

    const result = await Bun.file(dest).text();
    expect(result).toBe("hello bun");
    expect(Bun.file(dest).size).toBe(9);
  });

  test("Bun.write(file, Response, { append: true }) appends to existing file", async () => {
    using tmp = tempDir("bun-write-response-append", {});
    const dest = join(tmp, "dest.txt");
    await Bun.write(dest, "hello");

    await Bun.write(dest, new Response(" bun"), { append: true });

    const result = await Bun.file(dest).text();
    expect(result).toBe("hello bun");
    expect(Bun.file(dest).size).toBe(9);
  });

  test("Bun.write(file, Uint8Array, { append: true }) appends to existing file", async () => {
    using tmp = tempDir("bun-write-bytes-append", {});
    const dest = join(tmp, "dest.txt");
    await Bun.write(dest, "hello");

    await Bun.write(dest, new TextEncoder().encode(" bun"), { append: true });

    const result = await Bun.file(dest).text();
    expect(result).toBe("hello bun");
    expect(Bun.file(dest).size).toBe(9);
  });

  test("Bun.write(file, ReadableStream, { append: true }) appends to existing file", async () => {
    using tmp = tempDir("bun-write-stream-append", {});
    const dest = join(tmp, "dest.txt");
    await Bun.write(dest, "hello");

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(" bun");
        controller.close();
      },
    }).pipeThrough(new TextEncoderStream());

    await Bun.write(dest, stream, { append: true });

    const result = await Bun.file(dest).text();
    expect(result).toBe("hello bun");
    expect(Bun.file(dest).size).toBe(9);
  });

  test("Bun.file().writer({ append: true }) appends to existing file", async () => {
    using tmp = tempDir("bun-file-writer-append", {});
    const dest = join(tmp, "dest.txt");
    await Bun.write(dest, "hello");

    const writer = Bun.file(dest).writer({ append: true });
    writer.write(" bun");
    await writer.end();

    const result = await Bun.file(dest).text();
    expect(result).toBe("hello bun");
    expect(Bun.file(dest).size).toBe(9);
  });

  test("Bun.file().writer({ append: false }) truncates existing file", async () => {
    using tmp = tempDir("bun-file-writer-truncate", {});
    const dest = join(tmp, "dest.txt");
    await Bun.write(dest, "hello bun");

    const writer = Bun.file(dest).writer({ append: false });
    writer.write("bun");
    await writer.end();

    const result = await Bun.file(dest).text();
    expect(result).toBe("bun");
    expect(Bun.file(dest).size).toBe(3);
  });

  test("Bun.write(file, empty, { append: true }) does not truncate file", async () => {
    using tmp = tempDir("bun-write-empty-append", {});
    const dest = join(tmp, "dest.txt");
    await Bun.write(dest, "hello");

    await Bun.write(dest, "", { append: true });

    const result = await Bun.file(dest).text();
    expect(result).toBe("hello");
    expect(Bun.file(dest).size).toBe(5);
  });
});
