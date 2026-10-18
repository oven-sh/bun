import { file } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { basename, join } from "node:path";
import {
  createTestContext,
  destroyTestContext,
  dummyAfterAll,
  dummyBeforeAll,
  setContextHandler,
  type TestContext,
} from "./dummy.registry.js";

beforeAll(dummyBeforeAll);
afterAll(dummyAfterAll);

type PackageMap = Record<string, Record<string, { dependencies?: Record<string, string> }>>;

// Serves per-package version metadata from a local registry (tarballs live next
// to this file), so these tests never touch the public npm registry.
function makeRegistryHandler(ctx: TestContext, packages: PackageMap) {
  return async (request: Request) => {
    const url = request.url.replaceAll("%2f", "/");
    if (url.endsWith(".tgz")) {
      return new Response(file(join(import.meta.dir, basename(url).toLowerCase())));
    }
    const name = new URL(url).pathname.replace(`/${ctx.id}/`, "").replace(/^\//, "");
    const versionInfo = packages[name];
    if (!versionInfo) return new Response("not found", { status: 404 });
    const versions: Record<string, unknown> = {};
    let latest = "";
    for (const version of Object.keys(versionInfo)) {
      latest = version;
      versions[version] = {
        name,
        version,
        dist: { tarball: `${ctx.registry_url}${name}-${version}.tgz` },
        dependencies: versionInfo[version].dependencies ?? {},
      };
    }
    return new Response(JSON.stringify({ name, versions, "dist-tags": { latest } }));
  };
}

async function setup(options: {
  packages: PackageMap;
  dependencies: Record<string, string>;
  scanner: string;
  scannerEnabled?: boolean;
}) {
  const ctx = await createTestContext();
  setContextHandler(ctx, makeRegistryHandler(ctx, options.packages));
  const dir = ctx.package_dir;

  const writeBunfig = (withScanner: boolean) =>
    Bun.write(
      join(dir, "bunfig.toml"),
      `[install]
cache = false
registry = "${ctx.registry_url}"
saveTextLockfile = false
${withScanner ? `\n[install.security]\nscanner = "./scanner.js"\n` : ""}`,
    );

  await Promise.all([
    Bun.write(join(dir, "package.json"), JSON.stringify({ name: "test-app", dependencies: options.dependencies })),
    Bun.write(join(dir, "scanner.js"), options.scanner),
    writeBunfig(options.scannerEnabled ?? false),
  ]);

  return { ctx, dir, writeBunfig };
}

async function run(dir: string, args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd: dir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// Concurrent spawns contend for CPU on slow debug/ASAN lanes, so per-test wall
// time is higher than sequential even though total wall time drops. 30s matches
// the sibling security-scanner tests.
const timeout = 30_000;

describe.concurrent("bun update security edge cases", () => {
  test(
    "bun update detects vulnerability in updated version that was safe before",
    async () => {
      const { ctx, dir, writeBunfig } = await setup({
        packages: { baz: { "0.0.3": {}, "0.0.5": {} } },
        dependencies: { baz: "0.0.3" },
        scanner: `
module.exports = {
  scanner: {
    version: "1",
    scan: async function (payload) {
      const results = [];
      for (const pkg of payload.packages) {
        if (pkg.name === "baz" && pkg.version === "0.0.5") {
          results.push({
            package: "baz",
            level: "fatal",
            description: "CVE-2024-XXXX: Prototype pollution in baz 0.0.5",
            url: "https://example.com/CVE-2024-XXXX",
          });
        }
      }
      return results;
    },
  },
};`,
      });
      try {
        const install = await run(dir, ["install"]);
        expect(install.stderr).toContain("Saved lockfile");
        expect(install.exitCode).toBe(0);

        await writeBunfig(true);
        await Bun.write(
          join(dir, "package.json"),
          JSON.stringify({ name: "test-app", dependencies: { baz: ">=0.0.3" } }),
        );

        const { stdout, exitCode } = await run(dir, ["update"]);
        expect(stdout).toContain("FATAL: baz");
        expect(stdout).toContain("CVE-2024-XXXX: Prototype pollution in baz 0.0.5");
        expect(stdout).toContain("Installation aborted due to fatal security advisories");
        expect(exitCode).toBe(1);
      } finally {
        destroyTestContext(ctx);
      }
    },
    timeout,
  );

  test(
    "bun update <pkg> detects vulnerability in the specific updated package",
    async () => {
      const { ctx, dir, writeBunfig } = await setup({
        packages: { baz: { "0.0.3": {}, "0.0.5": {} } },
        dependencies: { baz: "0.0.3" },
        scanner: `
module.exports = {
  scanner: {
    version: "1",
    scan: async function (payload) {
      const results = [];
      for (const pkg of payload.packages) {
        if (pkg.name === "baz" && Bun.semver.satisfies(pkg.version, ">=0.0.5")) {
          results.push({
            package: "baz",
            level: "fatal",
            description: "CVE-2023-45857: baz vulnerable to SSRF in >=0.0.5",
            url: "https://nvd.nist.gov/vuln/detail/CVE-2023-45857",
          });
        }
      }
      return results;
    },
  },
};`,
      });
      try {
        const install = await run(dir, ["install"]);
        expect(install.stderr).toContain("Saved lockfile");
        expect(install.exitCode).toBe(0);

        await writeBunfig(true);

        const { stdout, exitCode } = await run(dir, ["update", "baz", "--latest"]);
        expect(stdout).toContain("FATAL: baz");
        expect(stdout).toContain("CVE-2023-45857: baz vulnerable to SSRF in >=0.0.5");
        expect(stdout).toContain("Installation aborted due to fatal security advisories");
        expect(exitCode).toBe(1);
      } finally {
        destroyTestContext(ctx);
      }
    },
    timeout,
  );

  test(
    "bun update detects newly discovered vulnerability in existing package",
    async () => {
      const { ctx, dir, writeBunfig } = await setup({
        packages: { baz: { "0.0.3": {} }, bar: { "0.0.2": {} } },
        dependencies: { baz: "0.0.3", bar: "0.0.2" },
        scanner: `
module.exports = {
  scanner: {
    version: "1",
    scan: async function (payload) {
      console.error("SCANNING_PACKAGES:", payload.packages.map(p => p.name + "@" + p.version).join(", "));
      const results = [];
      for (const pkg of payload.packages) {
        if (pkg.name === "baz" && pkg.version === "0.0.3") {
          results.push({
            package: "baz",
            level: "fatal",
            description: "CVE-2024-NEW: Newly discovered vulnerability in baz 0.0.3",
            url: "https://example.com/CVE-2024-NEW",
          });
        }
      }
      return results;
    },
  },
};`,
      });
      try {
        const install = await run(dir, ["install"]);
        expect(install.stderr).toContain("Saved lockfile");
        expect(install.exitCode).toBe(0);

        await writeBunfig(true);

        const { stdout, stderr, exitCode } = await run(dir, ["update"]);
        expect(stderr).toContain("SCANNING_PACKAGES:");
        expect(stderr).toMatch(/SCANNING_PACKAGES:.*baz@0\.0\.3/);
        expect(stderr).toMatch(/SCANNING_PACKAGES:.*bar@0\.0\.2/);
        expect(stdout).toContain("FATAL: baz");
        expect(stdout).toContain("CVE-2024-NEW");
        expect(stdout).toContain("Newly discovered vulnerability");
        expect(exitCode).toBe(1);
      } finally {
        destroyTestContext(ctx);
      }
    },
    timeout,
  );

  test(
    "bun pm scan detects vulnerability in existing transitive dependency after adding package",
    async () => {
      const { ctx, dir, writeBunfig } = await setup({
        packages: {
          "depends-on-monkey": { "0.0.2": { dependencies: { monkey: "0.0.2" } } },
          monkey: { "0.0.2": {} },
          bar: { "0.0.2": {} },
        },
        dependencies: { "depends-on-monkey": "^0.0.2" },
        scanner: `
module.exports = {
  scanner: {
    version: "1",
    scan: async function (payload) {
      const results = [];
      for (const pkg of payload.packages) {
        if (pkg.name === "monkey") {
          results.push({
            package: "monkey",
            level: "fatal",
            description: "Previously unknown vulnerability in monkey",
            url: "https://example.com/monkey-vuln",
          });
        }
      }
      return results;
    },
  },
};`,
      });
      try {
        const install = await run(dir, ["install"]);
        expect(install.stderr).toContain("Saved lockfile");
        expect(install.exitCode).toBe(0);

        const add = await run(dir, ["add", "bar"]);
        expect(add.stderr).toContain("Saved lockfile");
        expect(add.exitCode).toBe(0);

        await writeBunfig(true);

        const { stdout, exitCode } = await run(dir, ["pm", "scan"]);
        expect(stdout).toContain("FATAL: monkey");
        expect(stdout).toContain("via test-app › depends-on-monkey › monkey");
        expect(stdout).toContain("Previously unknown vulnerability");
        expect(exitCode).toBe(1);
      } finally {
        destroyTestContext(ctx);
      }
    },
    timeout,
  );

  test(
    "bun update with version range change exposes vulnerability",
    async () => {
      const { ctx, dir } = await setup({
        packages: { baz: { "0.0.3": {}, "0.0.5": {} } },
        dependencies: { baz: "0.0.3" },
        scannerEnabled: true,
        scanner: `
module.exports = {
  scanner: {
    version: "1",
    scan: async function (payload) {
      const results = [];
      for (const pkg of payload.packages) {
        if (pkg.name === "baz" && Bun.semver.satisfies(pkg.version, ">=0.0.5")) {
          results.push({
            package: "baz",
            level: "fatal",
            description: "CVE-2021-44906: Prototype pollution in baz >=0.0.5",
            url: "https://nvd.nist.gov/vuln/detail/CVE-2021-44906",
          });
        }
      }
      return results;
    },
  },
};`,
      });
      try {
        const install = await run(dir, ["install"]);
        expect(install.stdout).not.toContain("FATAL:");
        expect(install.stderr).toContain("Saved lockfile");
        expect(install.exitCode).toBe(0);

        await Bun.write(
          join(dir, "package.json"),
          JSON.stringify({ name: "test-app", dependencies: { baz: ">=0.0.3" } }),
        );

        const { stdout, exitCode } = await run(dir, ["update"]);
        expect(stdout).toContain("FATAL: baz");
        expect(stdout).toContain("CVE-2021-44906");
        expect(stdout).toContain("Prototype pollution");
        expect(stdout).toContain("Installation aborted due to fatal security advisories");
        expect(exitCode).toBe(1);
      } finally {
        destroyTestContext(ctx);
      }
    },
    timeout,
  );

  test(
    "bun pm scan detects newly discovered vulnerabilities in existing lockfile",
    async () => {
      const { ctx, dir, writeBunfig } = await setup({
        packages: { baz: { "0.0.3": {} }, bar: { "0.0.2": {} } },
        dependencies: { baz: "0.0.3", bar: "0.0.2" },
        scanner: `
module.exports = {
  scanner: {
    version: "1",
    scan: async function (payload) {
      const results = [];
      for (const pkg of payload.packages) {
        if (pkg.name === "baz" && pkg.version === "0.0.3") {
          results.push({
            package: "baz",
            level: "warn",
            description: "New vulnerability discovered in baz 0.0.3",
            url: "https://example.com/new-baz-vuln",
          });
        }
        if (pkg.name === "bar" && pkg.version === "0.0.2") {
          results.push({
            package: "bar",
            level: "fatal",
            description: "Critical vulnerability found in bar 0.0.2",
            url: "https://example.com/new-bar-vuln",
          });
        }
      }
      return results;
    },
  },
};`,
      });
      try {
        const install = await run(dir, ["install"]);
        expect(install.stderr).toContain("Saved lockfile");
        expect(install.exitCode).toBe(0);

        await writeBunfig(true);

        const { stdout, exitCode } = await run(dir, ["pm", "scan"]);
        expect(stdout).toContain("FATAL: bar");
        expect(stdout).toContain("Critical vulnerability found in bar 0.0.2");
        expect(stdout).toContain("WARNING: baz");
        expect(stdout).toContain("New vulnerability discovered in baz 0.0.3");
        expect(stdout).toContain("2 advisories");
        expect(exitCode).toBe(1);
      } finally {
        destroyTestContext(ctx);
      }
    },
    timeout,
  );
});
