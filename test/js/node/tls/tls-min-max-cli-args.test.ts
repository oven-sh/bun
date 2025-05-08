import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

const PRINT_MIN = ["-p", "tls.DEFAULT_MIN_VERSION"];
const PRINT_MAX = ["-p", "tls.DEFAULT_MAX_VERSION"];

describe("TLS min/max CLI args", () => {
  test.each([1, 1.1, 1.2, 1.3])("TLSv%s", async version => {
    {
      const child = Bun.spawn({
        cmd: [bunExe(), `--tls-min-v${version}`, ...PRINT_MIN],
        stdio: ["pipe", "pipe", "pipe"],
        env: bunEnv,
      });

      const stdout = await Bun.readableStreamToText(child.stdout);

      expect(stdout.trim()).toBe(`TLSv${version}`);
    }

    {
      const child = Bun.spawn({
        cmd: [bunExe(), `--tls-max-v${version}`, ...PRINT_MAX],
        stdio: ["pipe", "pipe", "pipe"],
        env: bunEnv,
      });

      const stdout = await Bun.readableStreamToText(child.stdout);

      expect(stdout.trim()).toBe(`TLSv${version}`);
    }
  });

  test("Specifying both min and max should exit with error code 1", async () => {
    const child = Bun.spawn({
      cmd: [bunExe(), "--tls-min-v1.3", "--tls-max-v1.3"],
      stdio: ["pipe", "pipe", "pipe"],
      env: bunEnv,
    });

    const stderr = await Bun.readableStreamToText(child.stderr);
    expect(stderr.trim()).toMatch(/not both/);

    expect(await child.exited).toBe(1);
  });

  test("Specifying multiple max flags should use the highest version", async () => {
    // Node.js docs:
    // Using --tls-max-v1.3 sets the default to 'TLSv1.3'. If multiple of the options are provided, the highest maximum is used.

    const child = Bun.spawn({
      cmd: [bunExe(), "--tls-max-v1.3", "--tls-max-v1.2", ...PRINT_MAX],
      stdio: ["pipe", "pipe", "pipe"],
      env: bunEnv,
    });

    const stdout = await Bun.readableStreamToText(child.stdout);
    expect(stdout.trim()).toBe("TLSv1.3");
  });

  test("Specifying multiple min flags should use the lowest version", async () => {
    // Node.js docs:
    // Using --tls-min-v1.3 sets the default to 'TLSv1.3'. If multiple of the options are provided, the lowest minimum is used.

    const child = Bun.spawn({
      cmd: [bunExe(), "--tls-min-v1.3", "--tls-min-v1.2", ...PRINT_MIN],
      stdio: ["pipe", "pipe", "pipe"],
      env: bunEnv,
    });

    const stdout = await Bun.readableStreamToText(child.stdout);
    expect(stdout.trim()).toBe("TLSv1.2");
  });

  test("Specifying invalid min and max flags should use the default values", async () => {
    {
      const child = Bun.spawn({
        cmd: [bunExe(), "--tls-max-v1.9999", ...PRINT_MAX],
        stdio: ["pipe", "pipe", "pipe"],
        env: bunEnv,
      });

      const stdout = await Bun.readableStreamToText(child.stdout);
      expect(stdout.trim()).toBe("TLSv1.3");
    }

    {
      const child = Bun.spawn({
        cmd: [bunExe(), "--tls-min-v1.9999", ...PRINT_MIN],
        stdio: ["pipe", "pipe", "pipe"],
        env: bunEnv,
      });

      const stdout = await Bun.readableStreamToText(child.stdout);
      expect(stdout.trim()).toBe("TLSv1");
    }
  });
});
