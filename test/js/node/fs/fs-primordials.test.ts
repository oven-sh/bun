import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// node:fs must keep working when user code replaces a built-in with a
// wrapper that changes results (a buggy polyfill, an instrumentation shim).
// Each case loads the modules first and patches the built-in afterwards, the
// way a polyfill installed after startup does.

async function runFixture(dir: string, file: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), file],
    env: bunEnv,
    cwd: dir,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test.concurrent("fs.cpSync copies every entry when Array.prototype[Symbol.iterator] is patched", async () => {
  using dir = tempDir("fs-cpsync-iterator", {
    "fixture.js": `
      const fs = require("fs");
      const path = require("path");
      fs.mkdirSync("d/e", { recursive: true });
      for (const f of ["d/1.txt", "d/2.txt", "d/e/3.txt"]) fs.writeFileSync(f, f);
      // Load internal/fs/cp-sync before the patch.
      fs.cpSync("d/1.txt", "warm.txt");
      // An existing destination keeps macOS off the clonefile fast path, so
      // the JS directory walker runs on every platform.
      fs.mkdirSync("d2");

      const orig = Array.prototype[Symbol.iterator];
      // A broken iterator polyfill that skips the first element.
      Array.prototype[Symbol.iterator] = function () {
        const it = orig.call(this);
        it.next();
        return it;
      };
      fs.cpSync("d", "d2", { recursive: true });
      Array.prototype[Symbol.iterator] = orig;

      const copied = fs.readdirSync("d2", { recursive: true }).map(p => p.replaceAll(path.sep, "/")).sort();
      console.log(JSON.stringify(copied));
    `,
  });
  const { stdout, stderr, exitCode } = await runFixture(String(dir), "fixture.js");
  expect(stdout).toBe('["1.txt","2.txt","e","e/3.txt"]\n');
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test.concurrent(
  "fs.promises.readFile keeps its encoding when Array.prototype[Symbol.iterator] is patched",
  async () => {
    using dir = tempDir("fs-readfile-iterator", {
      "in.txt": "hello",
      "fixture.js": `
      const fs = require("fs");
      const orig = Array.prototype[Symbol.iterator];
      const skipsFirst = function () {
        const it = orig.call(this);
        it.next();
        return it;
      };
      // The patch is live only while the call reads its arguments.
      function withPatch(fn) {
        Array.prototype[Symbol.iterator] = skipsFirst;
        try {
          return fn();
        } finally {
          Array.prototype[Symbol.iterator] = orig;
        }
      }
      (async () => {
        const text = await withPatch(() => fs.promises.readFile("in.txt", "utf8"));
        await withPatch(() => fs.promises.writeFile("out.txt", "written", "utf8"));
        await withPatch(() => fs.promises.appendFile("out.txt", "+more", "utf8"));
        console.log(typeof text, text, fs.readFileSync("out.txt", "utf8"));
      })();
    `,
    });
    const { stdout, stderr, exitCode } = await runFixture(String(dir), "fixture.js");
    expect(stdout).toBe("string hello written+more\n");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  },
);

test.concurrent("fs streams keep their file descriptor when Promise.prototype.then is patched", async () => {
  using dir = tempDir("fs-streams-then", {
    "in.txt": "hello",
    "fixture.js": `
      const fs = require("fs");
      const orig = Promise.prototype.then;
      const seen = [];
      // An instrumentation shim that changes resolved numbers by one.
      Promise.prototype.then = function (onFulfilled, onRejected) {
        return orig.call(
          this,
          value => {
            seen.push(typeof value === "number" ? value : typeof value);
            return onFulfilled(typeof value === "number" ? value + 1 : value);
          },
          onRejected,
        );
      };

      const w = fs.createWriteStream("out.txt");
      w.on("error", err => console.log("write stream error:", err.code));
      w.end("abcdef", () => {
        const r = fs.createReadStream("in.txt");
        let acc = "";
        r.on("data", d => (acc += d));
        r.on("error", err => console.log("read stream error:", err.code));
        r.on("close", () => {
          Promise.prototype.then = orig;
          console.log(JSON.stringify({ out: fs.readFileSync("out.txt", "utf8"), read: acc, seen }));
        });
      });
    `,
  });
  const { stdout, stderr, exitCode } = await runFixture(String(dir), "fixture.js");
  // Stock bun 1.4.0 printed EBADF errors for both streams and seen: [7, 8]:
  // the descriptors passed through the patched then() and came back off by one.
  expect(stdout).toBe(JSON.stringify({ out: "abcdef", read: "hello", seen: [] }) + "\n");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});
