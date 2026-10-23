import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { fork } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { text } from "node:stream/consumers";

const ok_repeated = "ok".repeat(16384);

test("child_process_send_cb", () => {
  const child = Bun.spawnSync({
    cmd: [bunExe(), import.meta.dirname + "/fixtures/child-process-send-cb-more.js"],
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      NO_COLOR: "1",
    },
  });
  const stdout_text = child.stdout.toString();
  const stderr_text = child.stderr.toString();
  // identical output to node (v23.4.0)
  expect("CHILD\n" + stdout_text + "\nPARENT\n" + stderr_text + "\nEXIT CODE: " + child.exitCode)
    .toMatchInlineSnapshot(`
      "CHILD
      send simple
      send ok.repeat(16384)
      send 2
      send 3
      send 4
      send 5
      cb simple null
      cb ok.repeat(16384) null
      cb 2 null
      cb 3 null
      cb 4 null
      cb 5 null
      send 6
      send 7
      cb 6 null
      cb 7 null

      PARENT
      parent got message "simple"
      parent got message "ok…ok"
      parent got message "2"
      parent got message "3"
      parent got message "4"
      parent got message "5"
      parent got message "6"
      parent got message "ok…ok"
      parent got exit event 0 null

      EXIT CODE: 0"
    `);
});

// Three messages of 1 MiB do not fit in any IPC socket buffer, so they are still queued when the
// channel goes down in the same tick. node v26.3.0 runs every callback, with null, in all of these.
describe.each(["json", "advanced"])("send() callbacks for messages still queued at close (%s)", serialization => {
  test.concurrent.each(["disconnect", "kill"])("run before 'close' after subprocess.%s()", async how => {
    using dir = tempDir("send-cb-at-close", {
      "child.js": `
        process.on("message", () => {});
        process.on("disconnect", () => process.exit(0));
      `,
    });
    const child = fork(path.join(String(dir), "child.js"), { env: bunEnv, serialization });
    try {
      const events = [];
      child.on("close", () => events.push("close"));
      const closed = once(child, "close");
      const pad = Buffer.alloc(1 << 20, "d").toString();
      for (let i = 0; i < 3; i++) child.send({ i, pad }, err => events.push(`callback ${i}: ${err}`));
      if (how === "kill") child.kill("SIGKILL");
      else child.disconnect();

      await closed;
      expect(events).toEqual(["callback 0: null", "callback 1: null", "callback 2: null", "close"]);
    } finally {
      child.kill("SIGKILL");
    }
  });

  test.concurrent("run before 'exit' after process.disconnect() in the child", async () => {
    using dir = tempDir("send-cb-at-close-child", {
      "child.js": `
        const { writeSync } = require("node:fs");
        const pad = Buffer.alloc(1 << 20, "d").toString();
        const errors = [];
        for (let i = 0; i < 3; i++) process.send({ i, pad }, err => errors.push(err));
        process.disconnect();
        process.on("exit", () => writeSync(1, JSON.stringify(errors)));
      `,
    });
    const child = fork(path.join(String(dir), "child.js"), {
      env: bunEnv,
      serialization,
      stdio: ["ignore", "pipe", "inherit", "ipc"],
    });
    try {
      const [stdout, [exitCode, signalCode]] = await Promise.all([text(child.stdout), once(child, "close")]);
      expect({ stdout, exitCode, signalCode }).toEqual({ stdout: "[null,null,null]", exitCode: 0, signalCode: null });
    } finally {
      child.kill("SIGKILL");
    }
  });
});
