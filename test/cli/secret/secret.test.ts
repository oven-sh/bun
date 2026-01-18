import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux } from "harness";

function runBunCommand(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  const result = Bun.spawnSync({
    cmd: [bunExe(), ...args],
    env: bunEnv,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    exitCode: result.exitCode,
  };
}

function runSecretCommand(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  return runBunCommand(["secret", ...args]);
}

function checkLibsecretAvailable(): boolean {
  if (!isLinux) return false;
  const probeService = "__probe__";
  const probeName = "__probe__";
  const set = runSecretCommand(["set", "-s", probeService, "-n", probeName, "__probe__"]);
  if (set.exitCode !== 0) return false;
  const del = runSecretCommand(["delete", "-s", probeService, "-n", probeName]);
  if (del.exitCode !== 0) return false;
  return true;
}

const libsecretAvailable = checkLibsecretAvailable();
const testService = `bun-test-${Date.now()}`;

describe("bun secret", () => {
  describe("help", () => {
    test("bun --help shows secret command", () => {
      const { stdout, exitCode } = runBunCommand(["--help"]);
      expect(stdout).toContain("secret");
      expect(exitCode).toBe(0);
    });

    test("bun secret shows help", () => {
      const { stdout, exitCode } = runSecretCommand([]);
      expect(stdout).toContain("Manage secrets");
      expect(exitCode).toBe(0);
    });
  });

  describe("invalid subcommand", () => {
    test("unknown subcommand returns error", () => {
      const { stderr, exitCode } = runSecretCommand(["invalid"]);
      expect(stderr).toContain("Unknown subcommand");
      expect(exitCode).toBe(1);
    });
  });

  describe("argument errors", () => {
    describe("set", () => {
      test("missing --service shows error", () => {
        const { stderr, exitCode } = runSecretCommand(["set"]);
        expect(stderr).toContain("Missing required --service");
        expect(exitCode).toBe(1);
      });

      test("missing name shows error", () => {
        const { stderr, exitCode } = runSecretCommand(["set", "-s", "test"]);
        expect(stderr).toContain("Missing required name");
        expect(exitCode).toBe(1);
      });

      test("missing value shows error", () => {
        const { stderr, exitCode } = runSecretCommand(["set", "-s", "test", "-n", "key"]);
        expect(stderr).toContain("Missing required value");
        expect(exitCode).toBe(1);
      });

      test("extra argument shows error", () => {
        const { stderr, exitCode } = runSecretCommand(["set", "-s", "test", "key", "value", "extra"]);
        expect(stderr).toContain("Unexpected argument");
        expect(exitCode).toBe(1);
      });
    });

    describe("get", () => {
      test("missing --service shows error", () => {
        const { stderr, exitCode } = runSecretCommand(["get"]);
        expect(stderr).toContain("Missing required --service");
        expect(exitCode).toBe(1);
      });

      test("missing name shows error", () => {
        const { stderr, exitCode } = runSecretCommand(["get", "-s", "test"]);
        expect(stderr).toContain("Missing required name");
        expect(exitCode).toBe(1);
      });

      test("extra argument shows error", () => {
        const { stderr, exitCode } = runSecretCommand(["get", "-s", "test", "key", "extra"]);
        expect(stderr).toContain("Unexpected argument");
        expect(exitCode).toBe(1);
      });
    });

    describe("delete", () => {
      test("missing --service shows error", () => {
        const { stderr, exitCode } = runSecretCommand(["delete"]);
        expect(stderr).toContain("Missing required --service");
        expect(exitCode).toBe(1);
      });

      test("missing name shows error", () => {
        const { stderr, exitCode } = runSecretCommand(["delete", "-s", "test"]);
        expect(stderr).toContain("Missing required name");
        expect(exitCode).toBe(1);
      });

      test("extra argument shows error", () => {
        const { stderr, exitCode } = runSecretCommand(["delete", "-s", "test", "key", "extra"]);
        expect(stderr).toContain("Unexpected argument");
        expect(exitCode).toBe(1);
      });
    });
  });

  describe.skipIf(!libsecretAvailable)("integration", () => {
    afterAll(() => {
      // Cleanup: delete test secrets
      runSecretCommand(["delete", "-s", testService, "-n", "integration-key"]);
      runSecretCommand(["delete", "-s", testService, "-n", "to-delete"]);
      runSecretCommand(["delete", "-s", testService, "-n", "special-key"]);
    });

    test("set and get secret", () => {
      const { exitCode: setExit, stderr: setStderr } = runSecretCommand([
        "set",
        "-s",
        testService,
        "-n",
        "integration-key",
        "integration-value",
      ]);
      expect(setStderr).toBe("");
      expect(setExit).toBe(0);

      const { stdout, exitCode, stderr } = runSecretCommand(["get", "-s", testService, "-n", "integration-key"]);
      expect(stderr).toBe("");
      expect(stdout.trim()).toBe("integration-value");
      expect(exitCode).toBe(0);
    });

    test("delete secret", () => {
      // First set a secret
      const { exitCode: setExit } = runSecretCommand(["set", "-s", testService, "-n", "to-delete", "temp-value"]);
      expect(setExit).toBe(0);

      // Delete it
      const { exitCode: deleteExit, stderr: deleteStderr } = runSecretCommand([
        "delete",
        "-s",
        testService,
        "-n",
        "to-delete",
      ]);
      expect(deleteStderr).toBe("");
      expect(deleteExit).toBe(0);

      // Verify it's gone
      const { exitCode: getExit } = runSecretCommand(["get", "-s", testService, "-n", "to-delete"]);
      expect(getExit).not.toBe(0);
    });

    test("get nonexistent secret returns error", () => {
      const { exitCode, stderr } = runSecretCommand(["get", "-s", testService, "-n", "nonexistent-key"]);
      expect(stderr.length).toBeGreaterThan(0);
      expect(exitCode).not.toBe(0);
    });

    test("special characters in values", () => {
      const specialValue = "value with spaces & special=chars!";
      const { exitCode: setExit } = runSecretCommand([
        "set",
        "-s",
        testService,
        "-n",
        "special-key",
        specialValue,
      ]);
      expect(setExit).toBe(0);

      const { stdout, exitCode } = runSecretCommand(["get", "-s", testService, "-n", "special-key"]);
      expect(stdout.trim()).toBe(specialValue);
      expect(exitCode).toBe(0);
    });
  });

  describe.skipIf(libsecretAvailable || !isLinux)("without libsecret", () => {
    test("set fails gracefully with libsecret error", () => {
      const { stderr, exitCode } = runSecretCommand(["set", "-s", "test", "-n", "key", "value"]);
      expect(stderr.toLowerCase()).toContain("libsecret");
      expect(exitCode).toBe(1);
    });

    test("get fails gracefully with libsecret error", () => {
      const { stderr, exitCode } = runSecretCommand(["get", "-s", "test", "-n", "key"]);
      expect(stderr.toLowerCase()).toContain("libsecret");
      expect(exitCode).toBe(1);
    });

    test("delete fails gracefully with libsecret error", () => {
      const { stderr, exitCode } = runSecretCommand(["delete", "-s", "test", "-n", "key"]);
      expect(stderr.toLowerCase()).toContain("libsecret");
      expect(exitCode).toBe(1);
    });
  });
});
