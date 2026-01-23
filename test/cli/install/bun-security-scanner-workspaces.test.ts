import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "node:path";
import { getRegistry, startRegistry, stopRegistry } from "./simple-dummy-registry";

test("security scanner receives packages from workspace dependencies", async () => {
  const registryUrl = await startRegistry(false);

  try {
    const registry = getRegistry();
    if (!registry) {
      throw new Error("Registry not found");
    }

    registry.clearRequestLog();
    registry.setScannerBehavior("none");

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

    const dir = tempDirWithFiles("scanner-workspaces", files);

    await Bun.write(
      join(dir, "bunfig.toml"),
      `[install]
cache.disable = true
registry = "${registryUrl}/"

[install.security]
scanner = "./scanner.js"`,
    );

    const { stdout, stderr } = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });

    const output = (await stdout.text()) + (await stderr.text());

    // The scanner should receive packages from all workspace dependencies
    expect(output).toContain("SCANNER_RAN:");

    // Extract the number of packages from the output
    const match = output.match(/SCANNER_RAN: (\d+) packages/);
    expect(match).toBeTruthy();

    const packagesScanned = parseInt(match![1], 10);
    // Exact package count: left-pad, is-even, is-odd (is-even <-> is-odd have circular deps)
    expect(packagesScanned).toBe(3);
  } finally {
    stopRegistry();
  }
});

test("security scanner receives packages from workspace dependencies with hoisted linker", async () => {
  const registryUrl = await startRegistry(false);

  try {
    const registry = getRegistry();
    if (!registry) {
      throw new Error("Registry not found");
    }

    registry.clearRequestLog();
    registry.setScannerBehavior("none");

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

    const dir = tempDirWithFiles("scanner-workspaces-hoisted", files);

    await Bun.write(
      join(dir, "bunfig.toml"),
      `[install]
cache.disable = true
linker = "hoisted"
registry = "${registryUrl}/"

[install.security]
scanner = "./scanner.js"`,
    );

    const { stdout, stderr } = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });

    const output = (await stdout.text()) + (await stderr.text());

    expect(output).toContain("SCANNER_RAN:");

    const match = output.match(/SCANNER_RAN: (\d+) packages/);
    expect(match).toBeTruthy();

    const packagesScanned = parseInt(match![1], 10);
    // Exact package count: left-pad, is-even, is-odd (is-even <-> is-odd have circular deps)
    expect(packagesScanned).toBe(3);
  } finally {
    stopRegistry();
  }
});

test("security scanner receives packages from workspace dependencies with isolated linker", async () => {
  const registryUrl = await startRegistry(false);

  try {
    const registry = getRegistry();
    if (!registry) {
      throw new Error("Registry not found");
    }

    registry.clearRequestLog();
    registry.setScannerBehavior("none");

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

    const dir = tempDirWithFiles("scanner-workspaces-isolated", files);

    await Bun.write(
      join(dir, "bunfig.toml"),
      `[install]
cache.disable = true
linker = "isolated"
registry = "${registryUrl}/"

[install.security]
scanner = "./scanner.js"`,
    );

    const { stdout, stderr } = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });

    const output = (await stdout.text()) + (await stderr.text());

    expect(output).toContain("SCANNER_RAN:");

    const match = output.match(/SCANNER_RAN: (\d+) packages/);
    expect(match).toBeTruthy();

    const packagesScanned = parseInt(match![1], 10);
    // Exact package count: left-pad, is-even, is-odd (is-even <-> is-odd have circular deps)
    expect(packagesScanned).toBe(3);
  } finally {
    stopRegistry();
  }
});
