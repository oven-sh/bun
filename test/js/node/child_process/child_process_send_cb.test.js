import { expect, test } from "bun:test";
import { bunExe } from "harness";

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
