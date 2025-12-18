import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithFiles } from "harness";
import { dirname, join } from "node:path";
import { getRegistry, startRegistry, stopRegistry } from "./simple-dummy-registry";

const __dirname = dirname(Bun.fileURLToPath(import.meta.url));
const ptyScript = join(__dirname, "security-scanner-pty.py");

let registryUrl: string;

beforeAll(async () => {
  registryUrl = await startRegistry(false);
});

afterAll(() => {
  stopRegistry();
});

/**
 * Run bun install in a PTY environment with a security scanner that returns warnings.
 * This allows testing the interactive prompt behavior.
 *
 * @param response - The response to send when prompted: 'y', 'n', 'Y', 'N', 'enter', 'other', or 'timeout'
 * @returns Object containing stdout, stderr, exitCode, and parsed markers
 */
async function runWithPty(response: string): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
  promptDetected: boolean;
  sentResponse: string | null;
  dir: string;
}> {
  const registry = getRegistry();
  if (!registry) {
    throw new Error("Registry not started");
  }

  registry.clearRequestLog();
  registry.setScannerBehavior("warn");

  // Create a test directory with a package.json and scanner
  const scannerCode = `export const scanner = {
  version: "1",
  scan: async function(payload) {
    if (payload.packages.length > 0) {
      return [{
        package: payload.packages[0].name,
        level: "warn",
        description: "Test warning for TTY prompt"
      }];
    }
    return [];
  }
};`;

  const dir = tempDirWithFiles("scanner-tty", {
    "package.json": JSON.stringify({
      name: "test-app",
      version: "1.0.0",
      dependencies: {
        "left-pad": "1.3.0",
      },
    }),
    "scanner.js": scannerCode,
    "bunfig.toml": `[install]
cache.disable = true
registry = "${registryUrl}/"

[install.security]
scanner = "./scanner.js"`,
  });

  const python = Bun.which("python3") ?? Bun.which("python");
  if (!python) {
    throw new Error("Python not found");
  }

  await using proc = Bun.spawn({
    cmd: [python, ptyScript, bunExe(), dir, response],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Parse markers from stdout
  const promptDetected = stdout.includes("PTY_PROMPT_DETECTED");
  const sentResponseMatch = stdout.match(/PTY_SENT_RESPONSE: (\S+)/);
  const sentResponse = sentResponseMatch ? sentResponseMatch[1] : null;

  return {
    stdout,
    stderr,
    exitCode,
    promptDetected,
    sentResponse,
    dir,
  };
}

/**
 * Run bun install WITHOUT a PTY (piped stdin) to verify non-TTY behavior.
 * In non-TTY mode, warnings should cause immediate failure without prompting.
 */
async function runWithoutPty(): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
  dir: string;
}> {
  const registry = getRegistry();
  if (!registry) {
    throw new Error("Registry not started");
  }

  registry.clearRequestLog();
  registry.setScannerBehavior("warn");

  // Create a test directory with a package.json and scanner
  const scannerCode = `export const scanner = {
  version: "1",
  scan: async function(payload) {
    if (payload.packages.length > 0) {
      return [{
        package: payload.packages[0].name,
        level: "warn",
        description: "Test warning for non-TTY"
      }];
    }
    return [];
  }
};`;

  const dir = tempDirWithFiles("scanner-no-tty", {
    "package.json": JSON.stringify({
      name: "test-app",
      version: "1.0.0",
      dependencies: {
        "left-pad": "1.3.0",
      },
    }),
    "scanner.js": scannerCode,
    "bunfig.toml": `[install]
cache.disable = true
registry = "${registryUrl}/"

[install.security]
scanner = "./scanner.js"`,
  });

  // Run without PTY - stdin is piped, not a TTY
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: dir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "pipe", // This ensures stdin is NOT a TTY
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  return {
    stdout,
    stderr,
    exitCode,
    dir,
  };
}

describe.skipIf(isWindows)("Security Scanner Non-TTY Behavior", () => {
  test("fails immediately with warning when no TTY available (cannot prompt)", async () => {
    const result = await runWithoutPty();

    // Should show the "no TTY" error message
    expect(result.stdout).toContain("Security warnings found. Cannot prompt for confirmation (no TTY).");
    expect(result.stdout).toContain("Installation cancelled.");

    // Should NOT show the prompt
    expect(result.stdout).not.toContain("Continue anyway? [y/N]");

    // Verify package was NOT installed
    const packageJsonPath = join(result.dir, "node_modules", "left-pad", "package.json");
    expect(await Bun.file(packageJsonPath).exists()).toBe(false);

    expect(result.exitCode).toBe(1);
  });
});

describe.skipIf(isWindows)("Security Scanner TTY Prompt", () => {
  test("shows prompt when TTY is available and warnings are found", async () => {
    const result = await runWithPty("y");

    expect(result.promptDetected).toBe(true);
    expect(result.stdout).toContain("Security warnings found.");
    expect(result.stdout).toContain("Continue anyway? [y/N]");
  });

  test("continues installation when user responds 'y'", async () => {
    const result = await runWithPty("y");

    expect(result.promptDetected).toBe(true);
    expect(result.sentResponse).toBe("y");
    expect(result.stdout).toContain("Continuing with installation...");

    // Verify package was installed
    const packageJsonPath = join(result.dir, "node_modules", "left-pad", "package.json");
    expect(await Bun.file(packageJsonPath).exists()).toBe(true);

    expect(result.exitCode).toBe(0);
  });

  test("continues installation when user responds 'Y'", async () => {
    const result = await runWithPty("Y");

    expect(result.promptDetected).toBe(true);
    expect(result.sentResponse).toBe("Y");
    expect(result.stdout).toContain("Continuing with installation...");

    // Verify package was installed
    const packageJsonPath = join(result.dir, "node_modules", "left-pad", "package.json");
    expect(await Bun.file(packageJsonPath).exists()).toBe(true);

    expect(result.exitCode).toBe(0);
  });

  test("cancels installation when user responds 'n'", async () => {
    const result = await runWithPty("n");

    expect(result.promptDetected).toBe(true);
    expect(result.sentResponse).toBe("n");
    expect(result.stdout).toContain("Installation cancelled.");

    // Verify package was NOT installed
    const packageJsonPath = join(result.dir, "node_modules", "left-pad", "package.json");
    expect(await Bun.file(packageJsonPath).exists()).toBe(false);

    expect(result.exitCode).toBe(1);
  });

  test("cancels installation when user responds 'N'", async () => {
    const result = await runWithPty("N");

    expect(result.promptDetected).toBe(true);
    expect(result.sentResponse).toBe("N");
    expect(result.stdout).toContain("Installation cancelled.");

    // Verify package was NOT installed
    const packageJsonPath = join(result.dir, "node_modules", "left-pad", "package.json");
    expect(await Bun.file(packageJsonPath).exists()).toBe(false);

    expect(result.exitCode).toBe(1);
  });

  test("cancels installation when user just presses Enter (default)", async () => {
    const result = await runWithPty("enter");

    expect(result.promptDetected).toBe(true);
    expect(result.sentResponse).toBe("enter");
    expect(result.stdout).toContain("Installation cancelled.");

    // Verify package was NOT installed
    const packageJsonPath = join(result.dir, "node_modules", "left-pad", "package.json");
    expect(await Bun.file(packageJsonPath).exists()).toBe(false);

    expect(result.exitCode).toBe(1);
  });

  test("cancels installation when user responds with other characters", async () => {
    const result = await runWithPty("other");

    expect(result.promptDetected).toBe(true);
    expect(result.sentResponse).toBe("other");
    expect(result.stdout).toContain("Installation cancelled.");

    // Verify package was NOT installed
    const packageJsonPath = join(result.dir, "node_modules", "left-pad", "package.json");
    expect(await Bun.file(packageJsonPath).exists()).toBe(false);

    expect(result.exitCode).toBe(1);
  });
});
