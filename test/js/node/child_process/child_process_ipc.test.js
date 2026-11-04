import { $ } from "bun";
import { bunEnv, bunExe, isWindows } from "harness";

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
