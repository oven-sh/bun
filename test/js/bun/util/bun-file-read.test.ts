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

// A read that is waiting on the io thread when its fd turns into an error
// condition used to reject with a made-up "Unknown Error" (errno 0, syscall
// "epoll_ctl"): the io thread read epoll's events bitmask as an errno. The
// error the fd actually has is what the retried recv() reports. Linux only:
// that dispatch is epoll's, and so is what produces the error condition here,
// closing a unix socket (the child's stdin is one) with unread data in it
// resets the peer instead of ending it.
it.skipIf(!isLinux)(
  "Bun.stdin.text() reports the socket's error when stdin is reset while the read is waiting",
  async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const read = Bun.stdin.text().then(
         text => ({ resolved: text }),
         err => ({ code: err.code, syscall: err.syscall }),
       );
       // Unread by the parent, so that closing its end resets ours.
       require("fs").writeSync(0, "x");
       process.stdout.write("reading\\n");
       process.stdout.write(JSON.stringify(await read));`,
      ],
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout: Uint8Array[] = [];
    const marker = Buffer.from("reading\n");
    let closed = false;
    for await (const chunk of proc.stdout) {
      stdout.push(chunk);
      if (!closed && Buffer.concat(stdout).indexOf(marker) !== -1) {
        closed = true;
        proc.stdin.end();
      }
    }
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

    expect({ stdout: Buffer.concat(stdout).toString(), stderr }).toEqual({
      stdout: "reading\n" + JSON.stringify({ code: "ECONNRESET", syscall: "recv" }),
      stderr: "",
    });
    expect(exitCode).toBe(0);
  },
);
