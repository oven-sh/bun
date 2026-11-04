import { $ } from "bun";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

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

test.skipIf(!isWindows)(
  "the channel of a child is closed by the time of its 'exit', also if both are found at once",
  async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const kernel32 = require("bun:ffi").dlopen("kernel32.dll", {
          OpenProcess: { args: ["u32", "i32", "u32"], returns: "u64" },
          WaitForSingleObject: { args: ["u64", "u32"], returns: "u32" },
          CloseHandle: { args: ["u64"], returns: "i32" },
        }).symbols;

        const child = require("child_process").spawn(process.execPath, ["-e", "process.send('hello')"], {
          stdio: ["inherit", "inherit", "inherit", "ipc"],
        });
        child.on("message", message => console.log("message:", message));
        child.on("exit", () => console.log("exit, connected:", child.connected));

        // The loop gets to look only when the message, the end of the channel and the exit are all there.
        const SYNCHRONIZE = 0x00100000;
        const handle = kernel32.OpenProcess(SYNCHRONIZE, 0, child.pid);
        if (!handle) throw new Error("OpenProcess failed");
        kernel32.WaitForSingleObject(handle, 0xffffffff);
        kernel32.CloseHandle(handle);
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout).toBe("message: hello\nexit, connected: false\n");
    expect(exitCode).toBe(0);
  },
);

test("a message that the loop finds behind the exit of the child is delivered", async () => {
  using dir = tempDir("ipc-message-behind-exit", {
    "fixture.mjs": `
      import { spawn } from "child_process";
      import { existsSync, readSync, writeFileSync } from "fs";

      function waitFor(file) {
        const deadline = Date.now() + 10_000;
        while (!existsSync(file)) {
          if (Date.now() > deadline) throw new Error("no " + file);
          Bun.sleepSync(1);
        }
      }

      const [, fixture, role] = process.argv;
      if (role === "child") {
        // It has the child's end of the channel too, and outlives the child.
        spawn(process.execPath, [fixture, "grandchild"], {
          stdio: ["pipe", "inherit", "inherit", 3],
          env: { ...process.env, NODE_CHANNEL_FD: "3", NODE_CHANNEL_SERIALIZATION_MODE: "json" },
          detached: true,
        });
        process.send("ready", () => {
          waitFor("parent-waits");
          process.exit(0);
        });
      } else if (role === "grandchild") {
        // Returns when the child is gone.
        try {
          readSync(0, Buffer.alloc(1));
        } catch {}
        process.send("late", () => {
          writeFileSync("late-sent", "");
          process.exit(0);
        });
      } else {
        const child = spawn(process.execPath, [fixture, "child"], { stdio: ["inherit", "inherit", "inherit", "ipc"] });
        child.on("message", message => {
          console.log(message);
          if (message !== "ready") return;
          // The loop gets to look again only when the child is gone and, after that, one more message has come.
          setImmediate(() => {
            writeFileSync("parent-waits", "");
            waitFor("late-sent");
          });
        });
      }
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout).toBe("ready\nlate\n");
  expect(exitCode).toBe(0);
});
