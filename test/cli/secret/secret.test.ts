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
  const { stderr } = runSecretCommand(["get", "-s", "__probe__", "-n", "__probe__"]);
  return !stderr.toLowerCase().includes("libsecret");
}

const libsecretAvailable = checkLibsecretAvailable();
const testService = `bun-test-${Date.now()}`;

describe("bun secret", () => {
  describe("help", () => {
    test("bun --help shows secret command", () => {
      const { stdout, exitCode } = runBunCommand(["--help"]);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("secret");
    });

    test("bun secret shows help", () => {
      const { stdout, exitCode } = runSecretCommand([]);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("Manage secrets");
    });
  });

  describe("invalid subcommand", () => {
    test("unknown subcommand returns error", () => {
      const { stderr, exitCode } = runSecretCommand(["invalid"]);
      expect(exitCode).toBe(1);
      expect(stderr).toContain("Unknown subcommand");
    });
  });

  describe("argument errors", () => {
    describe("set", () => {
      test("missing --service shows error", () => {
        const { stderr, exitCode } = runSecretCommand(["set"]);
        expect(exitCode).toBe(1);
        expect(stderr).toContain("Missing required --service");
      });

      test("missing name shows error", () => {
        const { stderr, exitCode } = runSecretCommand(["set", "-s", "test"]);
        expect(exitCode).toBe(1);
        expect(stderr).toContain("Missing required name");
      });

      test("missing value shows error", () => {
        const { stderr, exitCode } = runSecretCommand(["set", "-s", "test", "-n", "key"]);
        expect(exitCode).toBe(1);
        expect(stderr).toContain("Missing required value");
      });

      test("extra argument shows error", () => {
        const { stderr, exitCode } = runSecretCommand(["set", "-s", "test", "key", "value", "extra"]);
        expect(exitCode).toBe(1);
        expect(stderr).toContain("Unexpected argument");
      });
    });

    describe("get", () => {
      test("missing --service shows error", () => {
        const { stderr, exitCode } = runSecretCommand(["get"]);
        expect(exitCode).toBe(1);
        expect(stderr).toContain("Missing required --service");
      });

      test("missing name shows error", () => {
        const { stderr, exitCode } = runSecretCommand(["get", "-s", "test"]);
        expect(exitCode).toBe(1);
        expect(stderr).toContain("Missing required name");
      });

      test("extra argument shows error", () => {
        const { stderr, exitCode } = runSecretCommand(["get", "-s", "test", "key", "extra"]);
        expect(exitCode).toBe(1);
        expect(stderr).toContain("Unexpected argument");
      });
    });

    describe("delete", () => {
      test("missing --service shows error", () => {
        const { stderr, exitCode } = runSecretCommand(["delete"]);
        expect(exitCode).toBe(1);
        expect(stderr).toContain("Missing required --service");
      });

      test("missing name shows error", () => {
        const { stderr, exitCode } = runSecretCommand(["delete", "-s", "test"]);
        expect(exitCode).toBe(1);
        expect(stderr).toContain("Missing required name");
      });

      test("extra argument shows error", () => {
        const { stderr, exitCode } = runSecretCommand(["delete", "-s", "test", "key", "extra"]);
        expect(exitCode).toBe(1);
        expect(stderr).toContain("Unexpected argument");
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
      expect(setExit).toBe(0);
      expect(setStderr).toBe("");

      const { stdout, exitCode, stderr } = runSecretCommand(["get", "-s", testService, "-n", "integration-key"]);
      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(stdout.trim()).toBe("integration-value");
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
      expect(deleteExit).toBe(0);
      expect(deleteStderr).toBe("");

      // Verify it's gone
      const { exitCode: getExit } = runSecretCommand(["get", "-s", testService, "-n", "to-delete"]);
      expect(getExit).not.toBe(0);
    });

    test("get nonexistent secret returns error", () => {
      const { exitCode, stderr } = runSecretCommand(["get", "-s", testService, "-n", "nonexistent-key"]);
      expect(exitCode).not.toBe(0);
      expect(stderr.length).toBeGreaterThan(0);
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
      expect(exitCode).toBe(0);
      expect(stdout.trim()).toBe(specialValue);
    });
  });

  describe.skipIf(libsecretAvailable || !isLinux)("without libsecret", () => {
    test("set fails gracefully with libsecret error", () => {
      const { stderr, exitCode } = runSecretCommand(["set", "-s", "test", "-n", "key", "value"]);
      expect(exitCode).toBe(1);
      expect(stderr.toLowerCase()).toContain("libsecret");
    });

    test("get fails gracefully with libsecret error", () => {
      const { stderr, exitCode } = runSecretCommand(["get", "-s", "test", "-n", "key"]);
      expect(exitCode).toBe(1);
      expect(stderr.toLowerCase()).toContain("libsecret");
    });

    test("delete fails gracefully with libsecret error", () => {
      const { stderr, exitCode } = runSecretCommand(["delete", "-s", "test", "-n", "key"]);
      expect(exitCode).toBe(1);
      expect(stderr.toLowerCase()).toContain("libsecret");
    });
  });
});
