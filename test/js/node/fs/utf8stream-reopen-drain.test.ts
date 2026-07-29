import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Deflake for test/js/node/test/parallel/test-fastutf8stream-reopen.js.
//
// After reopen(), fileOpened() emits 'ready' synchronously (async mode). If a
// 'ready' listener calls write(), #actualWrite starts an async fs.write and
// sets #writing=true. fileOpened() must then NOT schedule its post-reopen
// nextTick 'drain': that drain would fire while the write is still in flight,
// so a listener that reads the file on 'drain' observes an empty file. The
// real flake surfaces when Bun's fs.write threadpool task completes after
// nextTick under CI load; here we force it deterministically by deferring the
// write callback with setImmediate.
test("fs.Utf8Stream: reopen does not emit 'drain' while a write started from 'ready' is pending", async () => {
  using dir = tempDir("utf8stream-reopen-drain", {});
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const { Utf8Stream } = require("node:fs");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert");

const dest = path.join(process.env.DIR, "a.log");
let afterReopen = false;
const slowFs = {
  write(fd, data, enc, cb) {
    if (afterReopen) {
      setImmediate(() => fs.write(fd, data, enc, cb));
    } else {
      fs.write(fd, data, enc, cb);
    }
  },
};

const stream = new Utf8Stream({ dest, sync: false, fs: slowFs });
assert.ok(stream.write("hello world\\n"));
assert.ok(stream.write("something else\\n"));
const after = dest + "-moved";

stream.once("drain", () => {
  fs.renameSync(dest, after);
  stream.reopen();
  stream.once("ready", () => {
    afterReopen = true;
    assert.ok(stream.write("after reopen\\n"));
    stream.once("drain", () => {
      assert.strictEqual(stream.writing, false, "'drain' fired while a write is in flight");
      assert.strictEqual(fs.readFileSync(after, "utf8"), "hello world\\nsomething else\\n");
      assert.strictEqual(fs.readFileSync(dest, "utf8"), "after reopen\\n");
      stream.end();
      stream.on("close", () => console.log("PASS"));
    });
  });
});
`,
    ],
    env: { ...bunEnv, DIR: String(dir) },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("PASS\n");
  expect(exitCode).toBe(0);
});
