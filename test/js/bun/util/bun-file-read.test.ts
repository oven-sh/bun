import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { tmpdir } from "node:os";
import path from "node:path";

it("offset should work in Bun.file() #4963", async () => {
  const filename = tmpdir() + "/bun.test.offset.txt";
  await Bun.write(filename, "contents");
  const file = Bun.file(filename);
  const slice = file.slice(2, file.size);
  const contents = await slice.text();
  expect(contents).toBe("ntents");
});

// do_read_loop picks its read target per iteration: the 64 KB stack buffer
// when self.buffer's spare capacity is smaller, otherwise the Vec's spare
// capacity directly. Cover both branches plus the max_length cap so the
// branch selection and the commit_spare path stay tied to the same decision.
describe("Bun.file read-loop target selection", () => {
  function pattern(size: number, seed: number) {
    const out = Buffer.alloc(size);
    for (let i = 0; i < size; i++) out[i] = (i * seed + 7) & 0xff;
    return out;
  }

  it.each([
    ["small file (stack-buffer path)", 1024],
    ["64 KB boundary", 64 * 1024],
    ["large file (spare-capacity path)", 256 * 1024 + 17],
  ] as const)("%s", async (_label, size) => {
    const bytes = pattern(size, 131);
    using dir = tempDir("bun-file-read-target", {});
    const p = path.join(String(dir), "data.bin");
    await Bun.write(p, bytes);

    const buf = new Uint8Array(await Bun.file(p).arrayBuffer());
    expect(buf.length).toBe(size);
    expect(Bun.hash(buf)).toBe(Bun.hash(bytes));
  });

  it("slice(offset, end) honours max_length across the stack/spare split", async () => {
    const size = 256 * 1024;
    const bytes = pattern(size, 97);
    using dir = tempDir("bun-file-read-slice", {});
    const p = path.join(String(dir), "data.bin");
    await Bun.write(p, bytes);

    // 70_000 bytes: larger than one stack-buffer fill, smaller than the whole
    // file, and not a multiple of 64 KB.
    const start = 10;
    const end = 70_010;
    const buf = new Uint8Array(await Bun.file(p).slice(start, end).arrayBuffer());
    expect(buf.length).toBe(end - start);
    expect(Bun.hash(buf)).toBe(Bun.hash(bytes.subarray(start, end)));
  });
});

// A Bun.file() whose store was already statted is a file of known size. Its
// readers stop at the size from their own fstat. They do not issue one more
// read() to find EOF. /proc/self/io counts the read syscalls of the subprocess.
describe.skipIf(!isLinux)("Bun.file read syscalls for a file of known size", () => {
  const fixture = /* js */ `
    import { readFileSync } from "node:fs";
    const file = process.argv.at(-1);
    const io = () => /^syscr: (\\d+)$/m.exec(readFileSync("/proc/self/io", "utf8"));
    if (!io()) {
      console.log(JSON.stringify({ supported: false }));
      process.exit(0);
    }
    const syscr = () => Number(io()[1]);
    const expected = readFileSync(file, "utf8");
    const drain = async stream => {
      const decoder = new TextDecoder();
      let out = "";
      for await (const chunk of stream) out += decoder.decode(chunk, { stream: true });
      return out + decoder.decode();
    };
    const N = 100;
    async function perOp(op) {
      for (let i = 0; i < 5; i++) await op();
      const before = syscr();
      let ok = true;
      for (let i = 0; i < N; i++) ok = (await op()) === expected && ok;
      return { ok, readsPerOp: Math.round((syscr() - before) / N) };
    }
    const open = touch => { const f = Bun.file(file); touch(f); return f; };
    console.log(JSON.stringify({
      supported: true,
      lastModifiedThenText: await perOp(() => open(f => f.lastModified).text()),
      lastModifiedThenStream: await perOp(() => drain(open(f => f.lastModified).stream())),
      sizeThenText: await perOp(() => open(f => f.size).text()),
      sizeThenStream: await perOp(() => drain(open(f => f.size).stream())),
    }));
  `;

  it("one read() per operation, no EOF probe", async () => {
    using dir = tempDir("bun-file-read-count", { "data.txt": Buffer.alloc(64 * 1024, "a").toString() });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture, path.join(String(dir), "data.txt")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    const { supported, ...counts } = JSON.parse(stdout);
    if (!supported) {
      console.warn("/proc/self/io has no syscr on this kernel, nothing to count");
      return;
    }
    // One read() returns the whole 64 KiB. A second one per operation is the EOF probe.
    expect(counts).toEqual({
      lastModifiedThenText: { ok: true, readsPerOp: 1 },
      lastModifiedThenStream: { ok: true, readsPerOp: 1 },
      sizeThenText: { ok: true, readsPerOp: 1 },
      sizeThenStream: { ok: true, readsPerOp: 1 },
    });
    expect(exitCode).toBe(0);
  });
});
