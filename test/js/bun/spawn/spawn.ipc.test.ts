import { spawn } from "bun";
import { describe, expect, it } from "bun:test";
import { bunExe, gcTick } from "harness";
import path from "path";

describe.each(["advanced", "json"])("ipc mode %s", mode => {
  it("the subprocess should be defined and the child should send", done => {
    gcTick();
    const returned_subprocess = spawn([bunExe(), path.join(__dirname, "bun-ipc-child.js")], {
      ipc: (message, subProcess) => {
        expect(subProcess).toBe(returned_subprocess);
        expect(message).toBe("hello");
        subProcess.kill();
        done();
        gcTick();
      },
      stdio: ["inherit", "inherit", "inherit"],
      serialization: mode,
    });
  });

  it("the subprocess should receive the parent message and respond back", done => {
    gcTick();

    const parentMessage = "I am your father";
    const childProc = spawn([bunExe(), path.join(__dirname, "bun-ipc-child-respond.js")], {
      ipc: (message, subProcess) => {
        expect(message).toBe(`pong:${parentMessage}`);
        subProcess.kill();
        done();
        gcTick();
      },
      stdio: ["inherit", "inherit", "inherit"],
      serialization: mode,
    });

    childProc.send(parentMessage);
    gcTick();
  });
});
