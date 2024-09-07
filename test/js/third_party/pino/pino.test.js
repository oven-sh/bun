import { expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";

it("using pino does not crash, particularly on windows", async () => {
  const proc = Bun.spawnSync({
    cmd: [
      bunExe(),
      "-e",
      `
      const pino = require("pino");
      const logger = pino({
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      });
      logger.info("hi");
    `,
    ],
    env: bunEnv,
    stdio: ["inherit", "pipe", "pipe"],
    cwd: import.meta.dir,
  });

  const err = proc.stderr.toString("utf8");
  const out = proc.stdout.toString("utf8");

  expect(err).toBeEmpty();
  expect(out).toContain("\u001B[32mINFO\u001B[39m");
  expect(out).toContain("\u001B[36mhi\u001B[39m\n");
  expect(proc.exitCode).toBe(0);
});
