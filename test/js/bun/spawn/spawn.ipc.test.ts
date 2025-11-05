import { spawn } from "bun";
import { describe, expect, it } from "bun:test";
import { bunExe, gcTick } from "harness";
import path from "path";

describe.each(["advanced", "json"])("ipc mode %s", mode => {
  it("the subprocess should be defined and the child should send", async () => {
    gcTick();
    const done = Promise.withResolvers<void>();

    await using returned_subprocess = spawn([bunExe(), path.join(__dirname, "bun-ipc-child.js")], {
      ipc: (message, subProcess) => {
        expect(subProcess).toBe(returned_subprocess);
        expect(message).toBe("hello");
        done.resolve();
        gcTick();
      },
      stdio: ["inherit", "inherit", "inherit"],
      serialization: mode,
    });

    await done.promise;
  });

  it("the subprocess should receive the parent message and respond back", async () => {
    gcTick();

    const parentMessage = "I am your father";
    const done = Promise.withResolvers<void>();

    await using childProc = spawn([bunExe(), path.join(__dirname, "bun-ipc-child-respond.js")], {
      ipc: (message, _subProcess) => {
        expect(message).toBe(`pong:${parentMessage}`);
        done.resolve();
        gcTick();
      },
      stdio: ["inherit", "inherit", "inherit"],
      serialization: mode,
    });

    childProc.send(parentMessage);
    gcTick();
    await done.promise;
  });
});
