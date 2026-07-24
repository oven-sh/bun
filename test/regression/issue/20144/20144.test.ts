import { it } from "bun:test";
import assert from "node:assert";
import { spawn } from "node:child_process";

it.skipIf(process.platform === "win32")(
  "should not time out",
  done => {
    const child = spawn(process.execPath, ["run", "./20144.fixture.ts"], {
      cwd: __dirname,
      stdio: [null, "inherit", "inherit", "ipc"],
      // Backstop only: SIGINT (sent on "hej") is what actually kills the
      // child. The fixture cc()-compiles C at startup, which takes ~1.1s on
      // debug builds and blows a 1s budget before "hej" is ever sent, so the
      // backstop must sit well above the slowest build's startup.
      timeout: 10_000,
      killSignal: "SIGKILL",
    });

    child.on("message", message => {
      if (message == "hej") {
        assert.ok(child.pid);
        process.kill(child.pid, "SIGINT");
      }
    });

    child.on("exit", (code, signal) => {
      assert.strictEqual(signal, "SIGINT");
      assert.strictEqual(code, null);
      done();
    });
  },
  15_000,
);
