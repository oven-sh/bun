import { spawnSync } from "bun";
import { afterEach, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { rmSync } from "node:fs";

describe("bunfig test options", () => {
  describe("timeout", () => {
    const getBunfigWithTimeout = (ms: number) => `[test]\ntimeout = ${ms}\n`;

    const getTestWithDuration = (ms: number) => {
      return `
        import { test } from "bun:test";
        test(\`takes ${ms} ms\`, async () => await Bun.sleep(${ms}));
      `;
    };

    const errorPtn = /timed out after (\d+)ms/;
    const durationPtn = /\(fail\) .* \[(\d+)(?:\.\d+)?ms\]/;
    let cwd: string;

    afterEach(() => {
      if (cwd) rmSync(cwd, { recursive: true });
    });

    test("bunfig timeout overrides default", () => {
      const bunfigTimeout = 500;
      cwd = tempDirWithFiles("test.bunfig.timeout", {
        "bunfig.toml": getBunfigWithTimeout(bunfigTimeout),
        "bun-test-bunfig-timeout.test.ts": getTestWithDuration(2000),
      });

      const result = spawnSync({
        cmd: [bunExe(), "-c=bunfig.toml", "test"],
        env: bunEnv,
        stderr: "pipe",
        cwd,
      });
      const stderr = result.stderr.toString().trim();

      const errorMatch = stderr.match(errorPtn);
      expect(errorMatch, "test didn't report timeout error to stderr").not.toBeNull();
      const errorTimeout = parseInt(errorMatch!.at(1)!);
      expect(errorTimeout, "test timeout error doesn't reflect bunfig value").toEqual(bunfigTimeout);

      const durationMatch = stderr.match(durationPtn);
      expect(durationMatch, "test didn't output failing result with actual duration to stderr").not.toBeNull();
      const duration = parseInt(durationMatch!.at(1)!);
      expect(duration, "test timed out before bunfig timeout value").toBeGreaterThanOrEqual(bunfigTimeout);
      expect(duration, "test didn't honor bunfig timeout value").toBeLessThanOrEqual(5000);
    });

    test("cli timeout overrides bunfig", () => {
      const cliTimeout = 500;
      const bunfigTimeout = 1000;
      cwd = tempDirWithFiles("test.cli.timeout.wins", {
        "bunfig.toml": getBunfigWithTimeout(bunfigTimeout),
        "bun-test-cli-timeout-wins.test.ts": getTestWithDuration(2000),
      });

      const result = spawnSync({
        cmd: [bunExe(), "-c=bunfig.toml", "test", "--timeout", `${cliTimeout}`],
        env: bunEnv,
        stderr: "pipe",
        cwd,
      });
      const stderr = result.stderr.toString().trim();

      const errorMatch = stderr.match(errorPtn);
      expect(errorMatch, "test didn't report timeout error to stderr").not.toBeNull();
      const errorTimeout = parseInt(errorMatch!.at(1)!);
      expect(errorTimeout, "test timeout error doesn't reflect cli value").toEqual(cliTimeout);

      const durationMatch = stderr.match(durationPtn);
      expect(durationMatch, "test didn't output failing result with actual duration to stderr").not.toBeNull();
      const duration = parseInt(durationMatch!.at(1)!);
      expect(duration, "test timed out before cli value").toBeGreaterThanOrEqual(cliTimeout);
      expect(duration, "test honored bunfig timeout instead of cli").toBeLessThan(bunfigTimeout);
    });
  });
});
