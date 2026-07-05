import { expect, it } from "bun:test";
import { isLinux, tempDir } from "harness";
import { tmpdir } from "node:os";
import { join } from "node:path";

it("offset should work in Bun.file() #4963", async () => {
  const filename = tmpdir() + "/bun.test.offset.txt";
  await Bun.write(filename, "contents");
  const file = Bun.file(filename);
  const slice = file.slice(2, file.size);
  const contents = await slice.text();
  expect(contents).toBe("ntents");
});

async function drain(stream: ReadableStream<Uint8Array>): Promise<string> {
  let out = "";
  const decoder = new TextDecoder();
  for await (const chunk of stream) out += decoder.decode(chunk, { stream: true });
  return out + decoder.decode();
}

// procfs/sysfs/cgroupfs files are regular files that stat as 0 bytes but read
// more, so a blob's stat size can never bound a read of the whole file.
const PROC_FILE = "/proc/version";

it.skipIf(!isLinux)("reading a procfs file is not capped by its stat size", async () => {
  const expected = await Bun.file(PROC_FILE).text();
  expect(expected.length).toBeGreaterThan(0);
  expect(Bun.file(PROC_FILE).size).toBe(0);

  // exists() and .size both resolve the lazy stat onto the blob; neither may
  // turn the blob into an empty one.
  const afterExists = Bun.file(PROC_FILE);
  expect(await afterExists.exists()).toBe(true);
  expect(await afterExists.text()).toBe(expected);

  const afterSize = Bun.file(PROC_FILE);
  expect(afterSize.size).toBe(0);
  expect(new TextDecoder().decode(await afterSize.bytes())).toBe(expected);

  const afterArrayBuffer = Bun.file(PROC_FILE);
  expect(await afterArrayBuffer.exists()).toBe(true);
  expect((await afterArrayBuffer.arrayBuffer()).byteLength).toBe(expected.length);
});

it.skipIf(!isLinux)("streaming a procfs file is not capped by its stat size", async () => {
  const expected = await Bun.file(PROC_FILE).text();

  expect(await drain(Bun.file(PROC_FILE).stream())).toBe(expected);
  expect(await drain(new Response(Bun.file(PROC_FILE)).body!)).toBe(expected);

  const afterExists = Bun.file(PROC_FILE);
  expect(await afterExists.exists()).toBe(true);
  expect(await drain(afterExists.stream())).toBe(expected);
});

it.skipIf(!isLinux)("a procfs file appended to FormData carries its contents", async () => {
  const expected = await Bun.file(PROC_FILE).text();

  const form = new FormData();
  form.append("f", Bun.file(PROC_FILE));
  expect(await new Response(form).text()).toContain(expected);
});

it.skipIf(!isLinux)("a procfs file uploaded as a fetch body is sent whole", async () => {
  const expected = await Bun.file(PROC_FILE).text();

  using server = Bun.serve({
    port: 0,
    fetch: async req => new Response(await req.text()),
  });

  expect(await (await fetch(server.url, { method: "POST", body: Bun.file(PROC_FILE) })).text()).toBe(expected);

  const afterExists = Bun.file(PROC_FILE);
  expect(await afterExists.exists()).toBe(true);
  expect(await (await fetch(server.url, { method: "POST", body: afterExists })).text()).toBe(expected);
});

it("a sliced Bun.file() keeps its bounds when uploaded as a fetch body", async () => {
  using dir = tempDir("bun-file-slice-fetch", { "hello.txt": "hello world" });
  const file = Bun.file(join(String(dir), "hello.txt"));

  using server = Bun.serve({
    port: 0,
    fetch: async req => new Response(await req.text()),
  });

  expect(await (await fetch(server.url, { method: "POST", body: file.slice(0, 5) })).text()).toBe("hello");
  expect(await (await fetch(server.url, { method: "POST", body: file })).text()).toBe("hello world");
});

it("a sliced Bun.file() keeps its bounds when read as a Response body", async () => {
  using dir = tempDir("bun-file-slice-body", { "hello.txt": "hello world" });
  const file = Bun.file(join(String(dir), "hello.txt"));

  expect(await drain(new Response(file.slice(0, 5)).body!)).toBe("hello");
  expect(await drain(new Response(file.slice(6, 11)).body!)).toBe("world");
  expect(await new Response(file.slice(0, 5)).text()).toBe("hello");
  expect(await drain(file.slice(0, 5).stream())).toBe("hello");
  expect(await file.slice(0, 0).text()).toBe("");
});

it("an empty file still reads empty after exists()", async () => {
  using dir = tempDir("bun-file-empty-after-exists", { "empty.txt": "" });
  const file = Bun.file(join(String(dir), "empty.txt"));

  expect(await file.exists()).toBe(true);
  expect(file.size).toBe(0);
  expect(await file.text()).toBe("");
  expect(await drain(file.stream())).toBe("");
});

it("a regular file still reads after exists()", async () => {
  using dir = tempDir("bun-file-after-exists", { "hello.txt": "hello world" });
  const file = Bun.file(join(String(dir), "hello.txt"));

  expect(await file.exists()).toBe(true);
  expect(file.size).toBe(11);
  expect(await file.text()).toBe("hello world");
  expect(await drain(file.stream())).toBe("hello world");
});
