import { $ } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

$.throws(false);

describe("yes", async () => {
  test("can pipe to a buffer", async () => {
    const buffer = Buffer.alloc(10);
    await $`yes > ${buffer}`;
    expect(buffer.toString()).toEqual("y\ny\ny\ny\ny\n");
  });

  test("can be overwritten by the first argument", async () => {
    const buffer = Buffer.alloc(18);
    await $`yes xy > ${buffer}`;
    expect(buffer.toString()).toEqual("xy\nxy\nxy\nxy\nxy\nxy\n");
  });

  test("ignores other arguments", async () => {
    const buffer = Buffer.alloc(17);
    await $`yes ab cd ef > ${buffer}`;
    expect(buffer.toString()).toEqual("ab cd ef\nab cd ef");
  });

  test("fills a buffer larger than one no-IO burst", async () => {
    // One no-IO burst writes ~4*BUFSIZ before `yes` re-schedules itself on
    // the event loop; a buffer larger than that forces the re-schedule path
    // at least once before the target fills and returns ENOSPC. Run in a
    // subprocess so a regression surfaces as a test failure rather than
    // aborting the runner.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `import { $ } from "bun";
         const buffer = Buffer.alloc(128 * 1024);
         const { exitCode, stderr } = await $\`yes hi > \${buffer}\`.nothrow().quiet();
         console.log(JSON.stringify({
           exitCode,
           stderr: stderr.toString(),
           head: buffer.subarray(0, 12).toString(),
           filled: buffer.indexOf(0) === -1,
         }));`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      exitCode: 1,
      stderr: "yes: ENOSPC\n",
      head: "hi\nhi\nhi\nhi\n",
      filled: true,
    });
    expect(exitCode).toBe(0);
  });

  async function run(files: Record<string, string>, cmd = [bunExe(), "main.js"]) {
    using dir = tempDir("yes", files);
    await using proc = Bun.spawn({ cmd, env: bunEnv, cwd: String(dir), stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode, signalCode: proc.signalCode };
  }

  // Windows writes to files asynchronously.
  describe.skipIf(isWindows).concurrent("to a target that is written on the spot", () => {
    test("lets the event loop turn while it fills a file", async () => {
      const main = `
        const order = [];
        const done = Bun.$\`yes ab > out\`.nothrow().then(r => order.push("exit " + r.exitCode));
        setImmediate(() => order.push("immediate"));
        await done;
        const text = await Bun.file("out").text();
        console.log(order.join(), text.length >= 1 << 20, Buffer.alloc(text.length, "ab\\n").toString() === text);
      `;
      // The file size limit ends the command with EFBIG.
      const cmd = ["sh", "-c", `trap '' XFSZ; ulimit -f 2048; exec "$0" main.js`, bunExe()];
      expect(await run({ "main.js": main }, cmd)).toEqual({
        stdout: "immediate,exit 1 true true\n",
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
    });

    test("lets its Worker be terminated", async () => {
      const main = `
        import { Worker, isMainThread, parentPort } from "node:worker_threads";
        if (isMainThread) {
          const worker = new Worker(import.meta.filename);
          worker.once("message", async () => console.log(await worker.terminate()));
        } else {
          const running = Bun.$\`yes > /dev/null\`.then(() => {});
          parentPort.postMessage("started");
          await running;
        }
      `;
      expect(await run({ "main.js": main })).toEqual({ stdout: "1\n", stderr: "", exitCode: 0, signalCode: null });
    });

    test("stops when another command of the script throws", async () => {
      const main = `await Bun.$\`yes > /dev/null | echo hi > \${new Blob(["x"])}\`.catch(e => console.log(e.message));`;
      expect(await run({ "main.js": main })).toEqual({
        stdout: "Cannot redirect stdout/stderr to an immutable blob. Expected a file\n",
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
    });

    test("stops when its ModuleGraph is disposed", async () => {
      const files = {
        "app.js": `export const start = () => void Bun.$\`yes > /dev/null\`.then(() => console.log("settled"));`,
        "main.js": `
          const graph = new Bun.ModuleGraph();
          const app = await graph.import(import.meta.dir + "/app.js");
          graph.run(app.start);
          setImmediate(() => (graph.dispose(), console.log("disposed")));
        `,
      };
      expect(await run(files)).toEqual({ stdout: "disposed\n", stderr: "", exitCode: 0, signalCode: null });
    });
  });
});
