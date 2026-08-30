import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { getRegistry, startRegistry, stopRegistry } from "./simple-dummy-registry";

let registryUrl: string;

beforeAll(async () => {
  registryUrl = await startRegistry(false);
  const registry = getRegistry();
  if (!registry) {
    throw new Error("Registry not found");
  }
  registry.setScannerBehavior("none");
});

afterAll(() => {
  stopRegistry();
});

describe.concurrent("security scanner workspaces", () => {
  test("security scanner receives packages from workspace dependencies", async () => {
    // Create a workspace setup with root package and multiple workspace packages
    const files = {
      "package.json": JSON.stringify(
        {
          name: "workspace-root",
          private: true,
          workspaces: ["packages/*"],
        },
        null,
        2,
      ),
      "packages/app1/package.json": JSON.stringify(
        {
          name: "app1",
          dependencies: {
            "left-pad": "1.3.0",
          },
        },
        null,
        2,
      ),
      "packages/app2/package.json": JSON.stringify(
        {
          name: "app2",
          dependencies: {
            "is-even": "1.0.0",
          },
        },
        null,
        2,
      ),
      "packages/lib1/package.json": JSON.stringify(
        {
          name: "lib1",
          dependencies: {
            "is-odd": "1.0.0",
          },
        },
        null,
        2,
      ),
      "scanner.js": `export const scanner = {
  version: "1",
  scan: async function(payload) {
    console.error("SCANNER_RAN: " + payload.packages.length + " packages");
    return [];
  }
}`,
    };

    await using dir = tempDir("scanner-workspaces", files);

    await Bun.write(
      join(String(dir), "bunfig.toml"),
      Bun.TOML.stringify({
        install: {
          cache: { disable: true },
          registry: `${registryUrl}/`,
          security: {
            scanner: "./scanner.js",
          },
        },
      }),
    );

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });

    const [stdoutText, stderrText] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const output = stdoutText + stderrText;

    // The scanner should receive packages from all workspace dependencies
    expect(output).toContain("SCANNER_RAN:");

    // Extract the number of packages from the output
    const match = output.match(/SCANNER_RAN: (\d+) packages/);
    expect(match).toBeTruthy();

    const packagesScanned = parseInt(match![1], 10);
    // Exact package count: left-pad, is-even, is-odd (is-even <-> is-odd have circular deps)
    expect(packagesScanned).toBe(3);
  });

  test("security scanner receives packages from workspace dependencies with hoisted linker", async () => {
    const files = {
      "package.json": JSON.stringify(
        {
          name: "workspace-root",
          private: true,
          workspaces: ["packages/*"],
        },
        null,
        2,
      ),
      "packages/app1/package.json": JSON.stringify(
        {
          name: "app1",
          dependencies: {
            "left-pad": "1.3.0",
          },
        },
        null,
        2,
      ),
      "packages/app2/package.json": JSON.stringify(
        {
          name: "app2",
          dependencies: {
            "is-even": "1.0.0",
          },
        },
        null,
        2,
      ),
      "scanner.js": `export const scanner = {
  version: "1",
  scan: async function(payload) {
    console.error("SCANNER_RAN: " + payload.packages.length + " packages");
    return [];
  }
}`,
    };

    await using dir = tempDir("scanner-workspaces-hoisted", files);

    await Bun.write(
      join(String(dir), "bunfig.toml"),
      Bun.TOML.stringify({
        install: {
          cache: { disable: true },
          linker: "hoisted",
          registry: `${registryUrl}/`,
          security: {
            scanner: "./scanner.js",
          },
        },
      }),
    );

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });

    const [stdoutText, stderrText] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const output = stdoutText + stderrText;

    expect(output).toContain("SCANNER_RAN:");

    const match = output.match(/SCANNER_RAN: (\d+) packages/);
    expect(match).toBeTruthy();

    const packagesScanned = parseInt(match![1], 10);
    // Exact package count: left-pad, is-even, is-odd (is-even <-> is-odd have circular deps)
    expect(packagesScanned).toBe(3);
  });

  test("security scanner receives packages from workspace dependencies with isolated linker", async () => {
    const files = {
      "package.json": JSON.stringify(
        {
          name: "workspace-root",
          private: true,
          workspaces: ["packages/*"],
        },
        null,
        2,
      ),
      "packages/app1/package.json": JSON.stringify(
        {
          name: "app1",
          dependencies: {
            "left-pad": "1.3.0",
          },
        },
        null,
        2,
      ),
      "packages/app2/package.json": JSON.stringify(
        {
          name: "app2",
          dependencies: {
            "is-even": "1.0.0",
          },
        },
        null,
        2,
      ),
      "scanner.js": `export const scanner = {
  version: "1",
  scan: async function(payload) {
    console.error("SCANNER_RAN: " + payload.packages.length + " packages");
    return [];
  }
}`,
    };

    await using dir = tempDir("scanner-workspaces-isolated", files);

    await Bun.write(
      join(String(dir), "bunfig.toml"),
      Bun.TOML.stringify({
        install: {
          cache: { disable: true },
          linker: "isolated",
          registry: `${registryUrl}/`,
          security: {
            scanner: "./scanner.js",
          },
        },
      }),
    );

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });

    const [stdoutText, stderrText] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const output = stdoutText + stderrText;

    expect(output).toContain("SCANNER_RAN:");

    const match = output.match(/SCANNER_RAN: (\d+) packages/);
    expect(match).toBeTruthy();

    const packagesScanned = parseInt(match![1], 10);
    // Exact package count: left-pad, is-even, is-odd (is-even <-> is-odd have circular deps)
    expect(packagesScanned).toBe(3);
  });

  const filteredScannerLayouts = [
    { linker: "hoisted", leftPad: ["node_modules", "left-pad"] },
    { linker: "isolated", leftPad: ["packages", "app1", "node_modules", "left-pad"] },
  ] as const;

  test.each(filteredScannerLayouts)(
    "a scanner from npm is installed even when --filter leaves out the root ($linker)",
    async ({ linker, leftPad }) => {
      const files = {
        "package.json": JSON.stringify(
          {
            name: "workspace-root",
            private: true,
            workspaces: ["packages/*"],
            dependencies: {
              "test-security-scanner": "1.0.0",
            },
          },
          null,
          2,
        ),
        "packages/app1/package.json": JSON.stringify(
          {
            name: "app1",
            dependencies: {
              "left-pad": "1.3.0",
            },
          },
          null,
          2,
        ),
        "bunfig.toml": Bun.TOML.stringify({
          install: {
            cache: { disable: true },
            registry: `${registryUrl}/`,
            security: {
              scanner: "test-security-scanner",
            },
          },
        }),
      };

      {
        await using dir = tempDir(`scanner-npm-filtered-install-${linker}`, files);

        await using proc = Bun.spawn({
          cmd: [bunExe(), "install", "--filter", "app1", `--linker=${linker}`],
          cwd: dir,
          stdout: "pipe",
          stderr: "pipe",
          env: bunEnv,
        });

        const [stdoutText, stderrText, exitCode] = await Promise.all([
          proc.stdout.text(),
          proc.stderr.text(),
          proc.exited,
        ]);
        expect(stdoutText + stderrText).toContain("Security scanner installed successfully");
        expect(exitCode).toBe(0);
        expect(await Bun.file(join(String(dir), ...leftPad, "package.json")).exists()).toBe(true);
        expect(
          await Bun.file(
            join(String(dir), "node_modules", ".bun", "left-pad@1.3.0", "node_modules", "left-pad", "package.json"),
          ).exists(),
        ).toBe(linker === "isolated");
      }

      {
        await using dir = tempDir(`scanner-npm-filtered-add-${linker}`, files);

        await using proc = Bun.spawn({
          cmd: [bunExe(), "add", "is-odd", "--filter", "app1", `--linker=${linker}`],
          cwd: dir,
          stdout: "pipe",
          stderr: "pipe",
          env: bunEnv,
        });

        const [stdoutText, stderrText, exitCode] = await Promise.all([
          proc.stdout.text(),
          proc.stderr.text(),
          proc.exited,
        ]);
        expect(stdoutText + stderrText).toContain("Security scanner installed successfully");
        expect(exitCode).toBe(0);
        expect(await Bun.file(join(String(dir), ...leftPad, "package.json")).exists()).toBe(true);
        expect(
          await Bun.file(
            join(String(dir), "node_modules", ".bun", "left-pad@1.3.0", "node_modules", "left-pad", "package.json"),
          ).exists(),
        ).toBe(linker === "isolated");
        const app1 = await Bun.file(join(String(dir), "packages", "app1", "package.json")).json();
        expect(app1.dependencies).toHaveProperty("is-odd");
      }
    },
  );
});
