// bun:ffi deletes callback, closeCallback and cfunction from Bun.FFI when it loads. In an executable that holds no code of the module, a file from disk loads it, and it runs from its text.
// The deletes succeed there, and COMPILED code that reads the three, asks for them with `in` and Object.hasOwn, and lists the keys sees them in front of the load and not behind it, as in `bun run`. Each thread has its own.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const shows = `const show = () => [typeof Bun.FFI.callback, typeof Bun.FFI.closeCallback, typeof Bun.FFI.cfunction, "callback" in Bun.FFI, Object.hasOwn(Bun.FFI, "closeCallback"), Object.keys(Bun.FFI).includes("cfunction")].join(" ");`;

const files = {
  "from-disk.cjs": `
    const ffi = require("bun:ffi");
    console.log("disk", typeof ffi.dlopen, "callback" in Bun.FFI, "closeCallback" in Bun.FFI, "cfunction" in Bun.FFI);`,
  "main.cjs": `
    ${shows}
    console.log("in front", show());
    require(require("node:path").resolve(process.argv[2]));
    console.log("behind", show());`,
  "thread.cjs": `
    ${shows}
    const { Worker, isMainThread, parentPort } = require("node:worker_threads");
    if (isMainThread) {
      const worker = new Worker(__filename, { argv: [process.argv[2]] });
      worker.on("message", said => console.log("worker", said));
      worker.on("exit", () => console.log("main", show()));
    } else {
      const inFront = show();
      require(require("node:path").resolve(process.argv[2]));
      parentPort.postMessage(inFront + " | " + show());
    }`,
};

const there = "function function function true true true";
const gone = "undefined undefined undefined false false false";

test.concurrent.each([
  ["main.cjs", [`in front ${there}`, "disk function false false false", `behind ${gone}`]],
  ["thread.cjs", ["disk function false false false", `worker ${there} | ${gone}`, `main ${there}`]],
])(
  "%s",
  async (entry, lines) => {
    using dir = tempDir("aot-what-bun-ffi-deletes", files);
    const cwd = String(dir);
    const printedBy = async (cmd: string[]) => {
      const { stdout, exitCode } = await run([...cmd, "./from-disk.cjs"], cwd, bunEnv);
      return { lines: stdout.split("\n").filter(Boolean), exitCode };
    };
    expect(await printedBy([bunExe(), "run", entry])).toEqual({ lines, exitCode: 0 });
    const executable = join(cwd, "program");
    const build = [
      bunExe(),
      "build",
      "--compile",
      "--aot",
      "--aot-allow-code-from-disk",
      entry,
      "--outfile",
      executable,
    ];
    expect((await run(build, cwd, bunEnv)).exitCode).toBe(0);
    expect(await printedBy([executable])).toEqual({ lines, exitCode: 0 });
  },
  240_000,
);
