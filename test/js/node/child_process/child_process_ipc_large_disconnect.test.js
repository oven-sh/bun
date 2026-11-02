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
