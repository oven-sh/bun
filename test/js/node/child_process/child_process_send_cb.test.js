import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";

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

// On Windows a write is never complete when send() returns, so each callback there needs a frame.
test.skipIf(isWindows)("a send() the channel takes at once keeps no AsyncContextFrame for its callback", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), import.meta.dirname + "/fixtures/child-process-send-cb-frames-fixture.js"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const expected = { stores: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, "big"], framesCreated: 0, ranBeforeNextTick: 10 };
  expect({ stdout, stderr, exitCode }).toEqual({
    stdout: JSON.stringify({ parent: expected, child: expected }) + "\n",
    stderr: "",
    exitCode: 0,
  });
});

// Node calls the callback of a send() with a handle when the message is written. Bun calls it
// when the peer has acknowledged the handle. This pins what Bun does, so that a change of it is a
// decision and not a side effect. On Windows Bun can lose the ACK of a handle (#37815).
test.skipIf(isWindows)(
  "the callback of a send() with a handle runs once the peer has acknowledged the handle",
  async () => {
    using dir = tempDir("child-process-send-cb-handle", {});
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        import.meta.dirname + "/fixtures/child-process-send-cb-handle-fixture.js",
        join(String(dir), "gate"),
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: JSON.stringify(["setImmediate", "callback"]) + "\n",
      stderr: "",
      exitCode: 0,
    });
  },
);
