// https://github.com/oven-sh/bun/issues/49616
//
// A FileHandle keeps its fd in a FinalizationRegistry, so that a handle that is dropped without close() gives the
// fd back. From 1.4.0 to 1.4.5 fs.promises.open() read `FinalizationRegistry` from globalThis and `register` and
// `unregister` from its prototype, each at the time of the call. A program that replaces any of the three (a sandbox
// such as just-bash does, while a script runs) made every open() reject and leak the fd.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

const tamper = /* js */ `
  const fs = require("node:fs");
  const { prototype } = FinalizationRegistry;
  const blocked = name => function () { throw new Error(name + " is blocked"); };
  const tamper = {
    "the global is replaced": () => { globalThis.FinalizationRegistry = blocked("FinalizationRegistry"); },
    "the global is deleted": () => { delete globalThis.FinalizationRegistry; },
    "register and unregister are replaced": () => {
      prototype.register = blocked("register");
      prototype.unregister = blocked("unregister");
    },
  };
  const openFds = () => fs.readdirSync(process.platform === "darwin" ? "/dev/fd" : "/proc/self/fd").length;
`;

async function run(program: string, ...args: string[]) {
  await using child = Bun.spawn({
    cmd: [bunExe(), "-e", tamper + program, ...args],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  return { stdout: stdout.trim(), stderr, exitCode };
}

test.concurrent.each(["the global is replaced", "the global is deleted", "register and unregister are replaced"])(
  "fs.promises.open() and FileHandle.close() work when %s",
  async how => {
    const program = /* js */ `
    tamper[process.argv[1]]();
    (async () => {
      const handle = await fs.promises.open(process.execPath);
      const { bytesRead } = await handle.read(Buffer.alloc(4), 0, 4, 0);
      await handle.close();
      console.log(bytesRead, handle.fd);
    })();
  `;
    expect(await run(program, how)).toEqual({ stdout: "4 -1", stderr: "", exitCode: 0 });
  },
);

test.concurrent.skipIf(isWindows)(
  "a dropped FileHandle still gives its fd back when all three are replaced",
  async () => {
    const program = /* js */ `
    for (const how in tamper) tamper[how]();
    const dropped = 20;
    const codes = [];
    process.on("uncaughtException", error => codes.push(error.code));
    (async () => {
      const before = openFds();
      await (async () => {
        for (let i = 0; i < dropped; i++) await fs.promises.open(process.execPath);
      })();
      while (codes.length < dropped) {
        Bun.gc(true);
        await new Promise(resolve => setImmediate(resolve));
      }
      console.log(JSON.stringify({ reported: codes.length, codes: [...new Set(codes)], left: openFds() - before }));
    })();
  `;
    expect(await run(program)).toEqual({
      stdout: JSON.stringify({ reported: 20, codes: ["ERR_INVALID_STATE"], left: 0 }),
      stderr: "",
      exitCode: 0,
    });
  },
);
