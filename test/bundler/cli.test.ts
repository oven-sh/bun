import { bunEnv, bunExe } from "harness";
import path from "path";
import { describe, expect, test } from "bun:test";

describe("bun build", () => {
  test("warnings dont return exit code 1", () => {
    const { stderr, exitCode } = Bun.spawnSync({
      cmd: [bunExe(), "build", path.join(import.meta.dir, "./fixtures/jsx-warning/index.jsx")],
      env: bunEnv,
    });
    expect(exitCode).toBe(0);
    expect(stderr.toString("utf8")).toContain(
      'warn: "key" prop before a {...spread} is deprecated in JSX. Falling back to classic runtime.',
    );
  });
});
