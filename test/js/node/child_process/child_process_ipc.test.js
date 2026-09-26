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

describe.concurrent("a message sent right after fork() reaches", () => {
  // The import chain keeps the entry's module graph loading, with the event loop turning, while the child's IPC
  // channel is already open. The same files give the same output under node.
  const chain = {
    "a.mjs": `import "./b.mjs";`,
    "b.mjs": `import "./c.mjs";`,
    "c.mjs": `import "./d.mjs";`,
    "d.mjs": `export {};`,
  };
  const parent = (preload, afterSend = "") => `
const child = require("node:child_process").fork("./main.mjs", [], { execArgv: ["--require", "./${preload}"] });
child.send("early");${afterSend}
child.on("message", (message, handle) => {
  if (handle) handle.close();
  else if (message === "ready") child.send("late");
  else {
    console.log(JSON.stringify(message));
    child.kill();
  }
});`;

  test.each([
    {
      name: "the entry's listener when a preload already listens",
      files: {
        "parent.cjs": parent("listens.cjs"),
        "listens.cjs": `process.on("message", () => {});`,
        "main.mjs": `
import "./a.mjs";
const seen = [];
process.on("message", message => {
  seen.push(message);
  if (message === "late") process.send(seen);
});
process.send("ready");`,
      },
      expected: ["early", "late"],
    },
    {
      // The handle's ack comes back while the entry still loads.
      name: "the entry's listener when a preload sends a handle",
      files: {
        "parent.cjs": parent("handle.cjs"),
        "handle.cjs": `
const server = require("node:net").createServer();
server.listen(0, "127.0.0.1", () => {
  process.send("server", server, error => {
    globalThis.handleSent = error === null;
  });
});`,
        "main.mjs": `
import "./a.mjs";
const seen = [];
process.on("message", message => {
  seen.push(message);
  if (message === "late") process.send({ seen, handleSent: globalThis.handleSent });
});
process.send("ready");`,
      },
      expected: { seen: ["early", "late"], handleSent: true },
    },
    {
      name: "the entry's listeners before the parent's disconnect() does",
      files: {
        "parent.cjs": parent("listens.cjs", `\nchild.disconnect();`),
        "listens.cjs": `process.on("message", () => {});`,
        "main.mjs": `
import "./a.mjs";
const seen = ["connected: " + process.connected];
process.on("message", message => seen.push(message));
process.on("disconnect", () => {
  seen.push("disconnect");
  console.log(JSON.stringify(seen));
});`,
      },
      expected: ["connected: true", "early", "disconnect"],
    },
  ])("$name", async ({ files, expected }) => {
    using dir = tempDir("fork-early-message", { ...chain, ...files });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "parent.cjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr }).toEqual({ stdout: JSON.stringify(expected) + "\n", stderr: expect.any(String) });
    expect(exitCode).toBe(0);
  });
});
