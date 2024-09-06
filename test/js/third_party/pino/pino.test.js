import { it, expect } from "bun:test";
import { bunExe, bunEnv } from "harness";

it("throwing inside preserves exit code", async () => {
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
  });

  expect(proc.exitCode).toBe(0);
  expect(proc.stderr.toString("utf8")).toBeEmpty();
});
