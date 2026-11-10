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

// node's disconnect() queues `finish` with process.nextTick, and `finish` closes the channel and emits 'disconnect':
// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/child_process.js#L908-L952
// So 'disconnect' comes before the ticks and promise reactions that the caller queues after the call, and before
// anything that the event loop runs. The timers of these fixtures are due when disconnect() is called.
describe("disconnect()", () => {
  async function run(files, ...args) {
    using dir = tempDir("ipc-disconnect", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout: stdout.trim(), stderr, exitCode };
  }

  const orderFixture = /* js */ `
    const { fork } = require("node:child_process");
    const [role, side, context] = process.argv.slice(2);

    function spin(ms) {
      const end = performance.now() + ms;
      while (performance.now() < end);
    }

    // target: process in a child, the ChildProcess in a parent.
    function disconnectAndReport(target) {
      const log = [];
      setTimeout(() => {
        log.push("timer");
        console.log(JSON.stringify(log));
      }, 1);
      spin(10);
      target.disconnect();
      log.push("connected=" + target.connected);
      target.on("disconnect", () => log.push("disconnect"));
      process.nextTick(() => log.push("nextTick"));
      Promise.resolve().then(() => log.push("promise"));
    }

    function inContext(onceReady, fn) {
      if (context === "main") return fn();
      onceReady(() => {
        if (context === "message") fn();
        else if (context === "timer") setTimeout(fn, 1);
        else setImmediate(fn);
      });
    }

    if (role === "child") {
      if (side === "process") {
        inContext(
          fn => process.once("message", fn),
          () => disconnectAndReport(process),
        );
      } else {
        process.on("disconnect", () => {});
      }
      if (context !== "main") process.send("ready");
    } else {
      const child = fork(__filename, ["child", side, context], { stdio: "inherit" });
      if (side === "process") {
        child.once("message", () => child.send("go"));
      } else {
        inContext(
          fn => child.once("message", fn),
          () => disconnectAndReport(child),
        );
      }
    }
  `;

  test.concurrent.each(
    ["process", "ChildProcess"].flatMap(side =>
      ["message", "timer", "immediate", "main"].map(context => [side, context]),
    ),
  )("%s: in context '%s' it emits 'disconnect' in the next tick", async (side, context) => {
    expect(await run({ "fixture.js": orderFixture }, "fixture.js", "parent", side, context)).toEqual({
      stdout: JSON.stringify(["connected=false", "disconnect", "nextTick", "promise", "timer"]),
      stderr: "",
      exitCode: 0,
    });
  });

  // The close is work of the event loop too, in node and in Bun: the loop comes back for it, so 'beforeExit' is
  // emitted a second time.
  const beforeExitFixture = /* js */ `
    const { fork } = require("node:child_process");
    const [role, side] = process.argv.slice(2);
    const log = [];
    const report = () => {
      log.push("exit");
      require("node:fs").writeSync(1, JSON.stringify(log));
    };
    if (role === "child" && side === "process") {
      process.on("beforeExit", () => {
        log.push("beforeExit");
        if (process.connected) process.disconnect();
      });
      process.on("disconnect", () => log.push("disconnect"));
      process.on("exit", report);
      process.channel.unref();
    } else if (role === "child") {
      process.on("disconnect", () => {});
      process.send("ready");
    } else {
      const child = fork(__filename, ["child", side], { stdio: "inherit" });
      if (side === "ChildProcess") {
        child.on("disconnect", () => log.push("disconnect"));
        child.once("message", () => child.unref());
        process.on("beforeExit", () => {
          log.push("beforeExit");
          if (child.connected) child.disconnect();
        });
        process.on("exit", report);
      }
    }
  `;

  test.concurrent.each(["process", "ChildProcess"])(
    "%s: in 'beforeExit' it keeps the event loop alive for the close",
    async side => {
      expect(await run({ "fixture.js": beforeExitFixture }, "fixture.js", "parent", side)).toEqual({
        stdout: JSON.stringify(["beforeExit", "disconnect", "beforeExit", "exit"]),
        stderr: "",
        exitCode: 0,
      });
    },
  );

  // node: the ack of a handle sends what waited behind it, then runs the disconnect() that waited too, which queues
  // `finish` with process.nextTick. So 'disconnect' follows the callback of the last send with nothing that the event
  // loop runs in between. https://github.com/nodejs/node/blob/v26.3.0/lib/internal/child_process.js#L676-L694
  test.concurrent.skipIf(isWindows)(
    "after the ack of a handle it emits 'disconnect' in the tick of the ack",
    async () => {
      const files = {
        "parent.js": /* js */ `
        const { fork } = require("node:child_process");
        const net = require("node:net");
        const log = [];
        const server = net.createServer().listen(0, "127.0.0.1", () => {
          const child = fork("child.js");
          child.on("disconnect", () => log.push("disconnect"));
          child.once("message", () => {
            child.send("server", server);
            child.send("after-handle", () => {
              log.push("send callback");
              setTimeout(() => {
                log.push("timer");
                console.log(JSON.stringify(log));
                server.close();
              }, 1);
              const end = performance.now() + 10;
              while (performance.now() < end);
            });
            child.disconnect();
            log.push("connected=" + child.connected);
          });
        });
      `,
        "child.js": /* js */ `
        process.on("message", (message, handle) => {
          if (handle) handle.close();
        });
        process.send("ready");
      `,
      };
      expect(await run(files, "parent.js")).toEqual({
        stdout: JSON.stringify(["connected=false", "send callback", "disconnect", "timer"]),
        stderr: "",
        exitCode: 0,
      });
    },
  );

  // Here the disconnect() still waits for the ack when the child exits, so the event loop finds the close. The
  // callback of the send that the close ends is queued before 'disconnect' is.
  test.concurrent.skipIf(isWindows)("a child that exits before the ack ends the send before 'disconnect'", async () => {
    const files = {
      "parent.js": /* js */ `
        const { spawn } = require("node:child_process");
        const net = require("node:net");
        const log = [];
        const server = net.createServer().listen(0, "127.0.0.1", () => {
          // It never opens its channel, so it never acknowledges the handle.
          const child = spawn(process.execPath, ["-e", "0"], { stdio: ["ignore", "inherit", "inherit", "ipc"] });
          child.on("disconnect", () => log.push("disconnect"));
          child.on("close", () => {
            console.log(JSON.stringify(log));
            server.close();
          });
          child.send("server", server, () => log.push("send callback"));
          child.disconnect();
          log.push("connected=" + child.connected);
        });
      `,
    };
    expect(await run(files, "parent.js")).toEqual({
      stdout: JSON.stringify(["connected=false", "send callback", "disconnect"]),
      stderr: "",
      exitCode: 0,
    });
  });
});
