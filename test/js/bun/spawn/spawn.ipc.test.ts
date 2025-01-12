import { spawn } from "bun";
import { describe, expect, it } from "bun:test";
import { bunExe, gcTick } from "harness";
import path from "path";

const messages = [
  "ASCII",
  // latin1
  String.fromCharCode(...("Copyright " + String.fromCharCode(0x00a9) + " 2025").split("").map(a => a.charCodeAt(0))),
  // UTF-16
  "🌟 Hello from the emoji! ✨",
];

for (const message of messages) {
  describe(JSON.stringify(message), () => {
    describe.each(["advanced", "json"])("ipc mode %s", mode => {
      it("the subprocess should be defined and the child should send", done => {
        gcTick();
        const returned_subprocess = spawn([bunExe(), path.join(__dirname, "bun-ipc-child.js"), message], {
          ipc: (reply, subProcess) => {
            expect(subProcess).toBe(returned_subprocess);
            expect(reply).toBe(message);
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

        const childProc = spawn([bunExe(), path.join(__dirname, "bun-ipc-child-respond.js")], {
          ipc: (reply, subProcess) => {
            expect(reply).toBe(`pong:${message}`);
            subProcess.kill();
            done();
            gcTick();
          },
          stdio: ["inherit", "inherit", "inherit"],
          serialization: mode,
        });

        childProc.send(message);
        gcTick();
      });
    });
  });
}
