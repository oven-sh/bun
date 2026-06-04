import { describe, expect, test } from "bun:test";
import { isPosix, tempDirWithFiles } from "harness";
import { createTestBuilder } from "./test_builder";
const TestBuilder = createTestBuilder(import.meta.path);

describe.if(isPosix)("IOWriter epipe", () => {
  TestBuilder.command`yes | head`
    .exitCode(0)
    .stdout("y\ny\ny\ny\ny\ny\ny\ny\ny\ny\n")
    .runAsTest("builtin pipe to command");

  test("concurrent", async () => {
    const promises = Array(100)
      .fill(0)
      .map(() => Bun.$`yes | head`.text());

    const results = await Promise.all(promises);
    for (const result of results) {
      expect(result).toBe("y\ny\ny\ny\ny\ny\ny\ny\ny\ny\n");
    }
  });
});

describe.if(isPosix)("IOReader/IOWriter teardown under callback frames", () => {
  // The shell's IOReader/IOWriter defer their FINAL ref release to the event
  // loop when it would otherwise run inside a bun_io read/write callback
  // frame (tearing down the BufferedReader/PipeWriter that is still on the
  // stack). These pipelines end readers/writers mid-stream (head exits early,
  // broken pipes via `yes`), which is the path where a child callback can
  // drop the last reference during dispatch.
  test("many sequential broken pipes with cat readers", async () => {
    for (let i = 0; i < 50; i++) {
      const out = await Bun.$`yes | head -n 3`.text();
      expect(out).toBe("y\ny\ny\n");
    }
  });

  test("cat into early-exiting consumer, repeated", async () => {
    const big = "x".repeat(64 * 1024) + "\n";
    const dir = tempDirWithFiles("shell-ioreader-teardown", {
      "big.txt": big.repeat(8),
    });
    for (let i = 0; i < 25; i++) {
      const out = await Bun.$`cat ${dir}/big.txt | head -n 1`.text();
      expect(out).toBe(big);
    }
  });

  test("concurrent pipelines tearing down mid-stream", async () => {
    const results = await Promise.all(
      Array(64)
        .fill(0)
        .map(() => Bun.$`yes | head -n 2`.text()),
    );
    for (const r of results) expect(r).toBe("y\ny\n");
  });
});

describe("IOWriter fd ownership across start", () => {
  // On Windows, opening a shell IOWriter over a pipe/tty hands HANDLE
  // ownership to libuv (`uv_pipe_open`); the writer start path must disarm
  // the retained fd so teardown doesn't double-close it (POSIX is unaffected
  // but runs the same code shape). Repeat enough times that a double-close
  // would hit a reused fd and corrupt an unrelated pipeline.
  test("repeated pipelines with writers into pipes", async () => {
    for (let i = 0; i < 40; i++) {
      const out = await Bun.$`echo hello-${i} | cat`.text();
      expect(out).toBe(`hello-${i}\n`);
    }
  });

  test("repeated redirects to files keep fds valid", async () => {
    const dir = tempDirWithFiles("shell-iowriter-fd", { "seed.txt": "seed\n" });
    for (let i = 0; i < 25; i++) {
      await Bun.$`echo line-${i} > ${dir}/out-${i % 3}.txt`;
      const content = await Bun.$`cat ${dir}/out-${i % 3}.txt`.text();
      expect(content).toBe(`line-${i}\n`);
    }
  });
});
