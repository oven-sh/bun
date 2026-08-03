import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isPosix, tempDir } from "harness";
import { join } from "node:path";
import { SocketFramer } from "./socket-framer";

// Reverse-connect mode: Bun dials the frontend's unix socket instead of
// listening. These tests verify Bun re-dials after the frontend drops the
// connection before sending Inspector.initialized, so --inspect-wait/-brk
// cannot be left waiting for a frontend that can no longer reach it.
describe.skipIf(!isPosix)("inspector reverse-connect re-dial", () => {
  for (const { label, args, env } of [
    { label: "--inspect-wait=unix:", args: (p: string) => [`--inspect-wait=unix:${p}`], env: bunEnv },
    { label: "--inspect-brk=unix:", args: (p: string) => [`--inspect-brk=unix:${p}`], env: bunEnv },
    {
      label: "BUN_INSPECT_CONNECT_TO=unix:",
      args: () => [],
      env: (p: string) => ({ ...bunEnv, BUN_INSPECT_CONNECT_TO: `unix://${p}` }),
    },
  ] as const) {
    test.concurrent(
      `bun ${label} re-dials after the frontend drops the connection before Inspector.initialized`,
      async () => {
        using dir = tempDir("inspect-reconnect", {});
        const sock = join(String(dir), "frontend.sock");
        const { promise: evaluated, resolve: resolveEvaluated } = Promise.withResolvers<unknown>();
        let dials = 0;
        let attached;
        const framer = new SocketFramer(message => {
          const parsed = JSON.parse(message);
          if (parsed.id === 3) resolveEvaluated(parsed);
        });
        using listener = Bun.listen({
          unix: sock,
          socket: {
            open: socket => {
              dials++;
              if (dials === 1) {
                // Simulate a frontend that accepted but went away before sending
                // Inspector.initialized (e.g. an editor extension restart).
                socket.end();
                return;
              }
              attached = socket;
              framer.send(socket, JSON.stringify({ id: 1, method: "Inspector.enable" }));
              framer.send(socket, JSON.stringify({ id: 2, method: "Inspector.initialized" }));
              framer.send(
                socket,
                JSON.stringify({ id: 3, method: "Runtime.evaluate", params: { expression: "1 + 1" } }),
              );
            },
            data: (socket, bytes) => framer.onData(socket, bytes),
            error: () => {},
            close: () => {},
          },
        });

        await using inspectee = spawn({
          cmd: [bunExe(), ...args(sock), "-e", "setInterval(()=>{},1000)"],
          env: typeof env === "function" ? env(sock) : env,
          stdout: "ignore",
          stderr: "pipe",
        });

        let stderr = "";
        (async () => {
          for await (const chunk of inspectee.stderr) stderr += new TextDecoder().decode(chunk);
        })().catch(() => {});

        // Race against process exit so a crash-type regression reports the exit
        // code and stderr rather than a bare timeout. The wedged case (no crash,
        // no second dial) still surfaces as a timeout.
        const result = await Promise.race([
          evaluated,
          inspectee.exited.then(code => ({ inspecteeExited: code, stderr })),
        ]);
        try {
          expect(result).toMatchObject({
            id: 3,
            result: { result: { type: "number", value: 2 } },
          });
          expect(dials).toBeGreaterThanOrEqual(2);
        } finally {
          attached?.end?.();
        }
      },
    );
  }
});
