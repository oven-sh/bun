import { bunEnv, bunExe, tempDir } from "harness";

test.each(["child", "parent"])("what the %s sent before disconnect() arrives", sender => {
  const file = __dirname + "/fixtures/child-process-ipc-large-disconect.mjs";
  const actual = Bun.spawnSync([bunExe(), file, sender]);

  expect(actual.stderr.toString()).toBe("");
  expect(actual.stdout.toString()).toBe(
    `2: a\n2: b\n2: c\n2: d\n163840: l\n229376: y\n163840: l\n229376: y\ndisconnected\n`,
  );
  expect(actual.exitCode).toBe(0);
});

// The end of the process takes along what the channel has taken and not passed on.
test.concurrent.each(["json", "advanced"])(
  "a message has left the process when the callback of send() runs (%s)",
  async serialization => {
    using dir = tempDir("ipc-exit-in-send-callback", {
      "fixture.mjs": `
      import { fork } from "child_process";

      if (process.send) {
        process.send(Buffer.alloc(3_000_000, "x").toString(), () => process.exit(0));
      } else {
        fork(process.argv[1], { serialization: process.argv[2] })
          .on("message", message => console.log("received: " + message.length))
          .on("exit", code => console.log("exit: " + code));
      }
    `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "fixture.mjs", serialization],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ lines: stdout.trim().split("\n").sort(), stderr, exitCode }).toEqual({
      lines: ["exit: 0", "received: 3000000"],
      stderr: "",
      exitCode: 0,
    });
  },
);

// What it sent before still goes out then, and the other end answers each message that it gets.
test.concurrent.each(["child", "parent"])("the %s gets no 'message' after its disconnect()", async sender => {
  using dir = tempDir("ipc-message-after-disconnect", {
    "fixture.mjs": `
      import { fork } from "child_process";

      const [sender, role = "parent"] = process.argv.slice(2);
      const other = role === "parent" ? fork(process.argv[1], [sender, "child"]) : process;

      if (role === sender) {
        let disconnected = false;
        let late = 0;
        other.on("message", () => {
          if (disconnected) late++;
        });
        other.on("disconnect", () => console.log("late: " + late));
        const big = Buffer.alloc(3_000_000, "x").toString();
        for (let i = 0; i < 4; i++) other.send(big);
        other.disconnect();
        disconnected = true;
      } else {
        let received = 0;
        other.on("message", () => {
          received++;
          other.send("answer", () => {});
        });
        other.on("disconnect", () => console.log("received: " + received));
      }
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.mjs", sender],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ lines: stdout.trim().split("\n").sort(), stderr, exitCode }).toEqual({
    lines: ["late: 0", "received: 4"],
    stderr: "",
    exitCode: 0,
  });
});

// Nothing of its own is on its way here, and the child finds all the messages with one read.
test.concurrent.each(["json", "advanced"])(
  "a disconnect() in a 'message' listener is the end of the messages that were read along with that one (%s)",
  async serialization => {
    using dir = tempDir("ipc-disconnect-in-listener", {
      "fixture.mjs": `
      import { fork } from "child_process";
      import { existsSync, writeFileSync } from "fs";

      if (process.send) {
        const deadline = Date.now() + 10_000;
        while (!existsSync("all-sent")) {
          if (Date.now() > deadline) throw new Error("not all were sent");
          Bun.sleepSync(1);
        }
        let received = 0;
        process.on("message", () => {
          if (++received === 1) process.disconnect();
        });
        process.on("disconnect", () => console.log("received: " + received));
      } else {
        const child = fork(process.argv[1], { serialization: process.argv[2] });
        let sent = 0;
        for (let i = 0; i < 20; i++) {
          child.send(i, () => {
            if (++sent === 20) writeFileSync("all-sent", "");
          });
        }
      }
    `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "fixture.mjs", serialization],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "received: 1\n", stderr: "", exitCode: 0 });
  },
);
