import { $ } from "bun";
import { bunEnv, bunExe, tempDir } from "harness";

test("child_process ipc", async () => {
  const output = await $`${bunExe()} ${import.meta.dir}/fixtures/ipc_fixture.js`.text();
  // node (v23.4.0) has identical output
  expect(output).toMatchInlineSnapshot(`
    "Parent received: {"status":"Child process started"}
    Child process exited with code 0
    send returned false
    uncaughtException ERR_IPC_CHANNEL_CLOSED
    cb ERR_IPC_CHANNEL_CLOSED
    "
  `);
});

const emitOverrideFixture = String.raw`
const { fork } = require("node:child_process");
const [mode, serialization, event] = process.argv.slice(2);
if (process.argv[5] === "child") {
  const originalEmit = process.emit;
  const seen = [];
  function emit(name, ...args) {
    if (name === event) {
      seen.push(["emit", this === process, args.length, args[0], args[1] === undefined]);
      if (mode === "suppress") return false;
    }
    if (name === "disconnect") {
      seen.push(["disconnect", this === process, args.length]);
      console.log(JSON.stringify(seen));
    }
    return Reflect.apply(originalEmit, this, [name, ...args]);
  }
  if (mode === "getter") {
    Object.defineProperty(process, "emit", { configurable: true, get: () => emit });
  } else if (mode === "prototype") {
    delete process.emit;
    Object.getPrototypeOf(process).emit = emit;
  } else {
    process.emit = emit;
  }
  if (mode !== "listenerless") process.on(event, value => seen.push(["listener", value]));
  process.channel.ref();
  process.send("ready");
} else {
  const child = fork(__filename, [mode, serialization, event, "child"], {
    serialization, stdio: ["ignore", "inherit", "inherit", "ipc"]
  });
  child.on("error", error => { throw error; });
  child.once("message", () => {
    child.send({ cmd: event === "internalMessage" ? "NODE_PROBE" : "probe" }, error => {
      if (error) throw error;
      child.disconnect();
    });
  });
  child.once("exit", (code, signal) => {
    if (signal || code !== 0) process.exitCode = 1;
  });
}
`;

for (const serialization of ["json", "advanced"]) {
  for (const event of ["message", "internalMessage"]) {
    test.concurrent.each(["assignment", "getter", "prototype", "listenerless", "suppress"])(
      `child IPC ${serialization} ${event} uses process.emit (%s)`,
      async mode => {
        using dir = tempDir("ipc-emit-", { "fixture.cjs": emitOverrideFixture });
        await using child = Bun.spawn({
          cmd: [bunExe(), "fixture.cjs", mode, serialization, event],
          cwd: String(dir),
          env: bunEnv,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
        const message = { cmd: event === "internalMessage" ? "NODE_PROBE" : "probe" };
        const expected = mode === "listenerless" && event === "message" ? [] : [["emit", true, 2, message, true]];
        if (mode !== "listenerless" && mode !== "suppress") expected.push(["listener", message]);
        expected.push(["disconnect", true, 0]);
        expect({ stdout, stderr, exitCode }).toEqual({
          stdout: JSON.stringify(expected) + "\n",
          stderr: "",
          exitCode: 0,
        });
      },
    );
  }
}
