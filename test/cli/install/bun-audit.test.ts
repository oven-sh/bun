import { file, spawn, write } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { exists, readlink } from "fs/promises";
import {
  DirectoryTree,
  VerdaccioRegistry,
  bunEnv,
  bunExe,
  gunzipJsonRequest,
  lazyPromiseLike,
  normalizeBunSnapshot,
  runBunInstall,
  tempDir,
} from "harness";
import { join } from "node:path";
import { resolveBulkAdvisoryFixture } from "./registry/fixtures/audit/audit-fixtures";

function fixture(
  folder:
    | "express@3"
    | "vuln-with-only-dev-dependencies"
    | "safe-is-number@7"
    | "mix-of-safe-and-vulnerable-dependencies",
) {
  return join(import.meta.dirname, "registry", "fixtures", "audit", folder);
}

let server: Bun.Server;
const verdaccio = new VerdaccioRegistry();

beforeAll(async () => {
  server = Bun.serve({
    port: 0,
    fetch: async req => {
      const body = await gunzipJsonRequest(req);

      const fixture = resolveBulkAdvisoryFixture(body);

      if (!fixture) {
        console.log("No fixture found for", body);
        return new Response("No fixture found", { status: 404 });
      }

      return Response.json(fixture);
    },
  });
  await verdaccio.start();
});

afterAll(() => {
  server?.stop();
  verdaccio.stop();
});

function doAuditTest(
  label: string,
  options: {
    args?: string[];
    exitCode: number;
    files: DirectoryTree | string;
    fn: (std: { stdout: PromiseLike<string>; stderr: PromiseLike<string>; dir: string }) => Promise<void>;
  },
) {
  test(label, async () => {
    await using dir = tempDir("bun-test-audit-" + label.replace(/[^a-zA-Z0-9]/g, "-"), options.files);

    const cmd = [bunExe(), "audit", ...(options.args ?? [])];

    const url = server.url.toString().slice(0, -1);

    const proc = spawn({
      cmd,
      stdout: "pipe",
      stderr: "pipe",
      cwd: dir,
      env: {
        ...bunEnv,
        NPM_CONFIG_REGISTRY: url,
      },
    });

    const stdout = lazyPromiseLike(() => proc.stdout.text());
    const stderr = lazyPromiseLike(() => proc.stderr.text());

    const exitCode = await proc.exited;

    try {
      expect(exitCode).toBe(options.exitCode);
      await options.fn({ stdout, stderr, dir });
    } catch (e) {
      const err = await stderr;
      const out = await stdout;

      // useful to see what went wrong otherwise
      // we are just eating the rror silently

      console.log("ERR:", err);
      console.log("OUT:", out);

      throw e; //but still rethrow so test fails
    }
  });
}

type Advisory = { id: number; title: string; severity: string; url: string; vulnerable_versions: string };

function adv(range: string, id = 1): Advisory {
  return {
    id,
    title: "test advisory",
    severity: "high",
    url: "https://example.invalid/advisory/" + id,
    vulnerable_versions: range,
  };
}

type RegistryOptions = {
  // Serve the bulk response verbatim instead of filtering advisories by the submitted versions.
  bulkResponse?: unknown;
  bulkStatus?: number;
  // Package names whose manifest requests answer 404; mutable so a test can break the registry after installing.
  denyManifests?: Set<string>;
};

// Answers the bulk-advisory endpoint itself and proxies everything else to verdaccio.
function startRegistry(advisories: Record<string, Advisory[]>, options: RegistryOptions = {}) {
  return Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method === "POST" && url.pathname === "/-/npm/v1/security/advisories/bulk") {
        if (options.bulkStatus) return new Response("registry exploded", { status: options.bulkStatus });
        if (options.bulkResponse !== undefined) return Response.json(options.bulkResponse);
        const body: Record<string, string[]> = await gunzipJsonRequest(req);
        const out: Record<string, Advisory[]> = {};
        for (const [name, versions] of Object.entries(body)) {
          const matching = (advisories[name] ?? []).filter(a =>
            versions.some(v => Bun.semver.satisfies(v, a.vulnerable_versions)),
          );
          if (matching.length > 0) out[name] = matching;
        }
        return Response.json(out);
      }

      if (options.denyManifests?.has(decodeURIComponent(url.pathname.slice(1)))) {
        return new Response("not found", { status: 404 });
      }

      const up = await fetch(new URL(url.pathname + url.search, verdaccio.registryUrl()), {
        method: req.method,
        headers: { accept: req.headers.get("accept") ?? "*/*" },
      });
      return new Response(up.body, {
        status: up.status,
        headers: { "content-type": up.headers.get("content-type") ?? "application/octet-stream" },
      });
    },
  });
}

type Registry = ReturnType<typeof startRegistry>;

function writeBunfig(dir: string, server: Registry) {
  return write(
    join(dir, "bunfig.toml"),
    Bun.TOML.stringify({
      install: { cache: join(dir, ".bun-cache"), registry: server.url.href, saveTextLockfile: true },
    }),
  );
}

// The CI runner exports one BUN_INSTALL_CACHE_DIR per file, which overrides the bunfig cache the concurrent cases rely on.
function installEnv(dir: string) {
  return { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(dir, ".bun-cache") };
}

async function setup(server: Registry, pkgJson: object, extraFiles: Record<string, string> = {}) {
  const dir = tempDir("audit-fix-", { "package.json": JSON.stringify(pkgJson), ...extraFiles });
  await writeBunfig(dir, server);
  await runBunInstall(installEnv(dir), dir);
  return dir;
}

async function reinstall(dir: string, pkgJson: object) {
  await write(join(dir, "package.json"), JSON.stringify(pkgJson));
  await runBunInstall(installEnv(dir), dir);
}

async function run(dir: string, args: string[], root: string = dir) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    env: installEnv(root),
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

function auditFix(dir: string, ...args: string[]) {
  return run(dir, ["audit", "fix", ...args]);
}

function audit(dir: string, ...args: string[]) {
  return run(dir, ["audit", ...args]);
}

function lock(dir: string) {
  return file(join(dir, "bun.lock")).text();
}

async function installedVersion(dir: string, ...segments: string[]) {
  return (await file(join(dir, "node_modules", ...segments, "package.json")).json()).version;
}

// a-dep@1.0.2 stays installed after the range is widened because the still-satisfied edge is not re-resolved.
async function setupVulnerableADep(server: Registry) {
  const dir = await setup(server, { name: "foo", dependencies: { "a-dep": "1.0.2" } });
  await reinstall(dir, { name: "foo", dependencies: { "a-dep": "^1.0.2" } });
  expect(await lock(dir)).toContain('"a-dep@1.0.2"');
  return dir;
}

describe("`bun audit`", () => {
  doAuditTest("should fail with no package.json", {
    exitCode: 1,
    files: {
      "README.md": "This place sure is empty...",
    },
    fn: async ({ stderr }) => {
      expect(await stderr).toContain("No package.json was found for directory");
    },
  });

  doAuditTest("should fail with package.json but no lockfile", {
    exitCode: 1,
    files: {
      "package.json": JSON.stringify({
        name: "test",
        version: "1.0.0",
        dependencies: {
          "express": "3",
        },
      }),
    },
    fn: async ({ stderr }) => {
      expect(await stderr).toContain("error: Lockfile not found");
    },
  });

  doAuditTest("should exit 0 when there are no dependencies in package.json", {
    exitCode: 0,
    files: {
      // i deemed this small enough to justify not needing a fixture
      "package.json": JSON.stringify({
        name: "empty-package",
        version: "1.0.0",
      }),
      "bun.lock": JSON.stringify({
        "lockfileVersion": 1,
        "workspaces": {
          "": {
            "name": "empty-package",
          },
        },
        "packages": {},
      }),
    },
    fn: async ({ stdout }) => {
      expect(await stdout).toBe("No vulnerabilities found\n");
    },
  });

  doAuditTest("should exit 0 when there are no vulnerabilities", {
    exitCode: 0,
    files: fixture("safe-is-number@7"),
    fn: async ({ stdout }) => {
      expect(await stdout).toBe("No vulnerabilities found\n");
    },
  });

  doAuditTest("should exit code 1 when there are vulnerabilities", {
    exitCode: 1,
    files: fixture("express@3"),
    fn: async ({ stdout }) => {
      expect(await stdout).toMatchSnapshot("bun-audit-expect-vulnerabilities-found");
    },
  });

  doAuditTest("should print valid JSON and exit 0 when --json is passed and there are no vulnerabilities", {
    exitCode: 0,
    files: fixture("safe-is-number@7"),
    args: ["--json"],
    fn: async ({ stdout }) => {
      const out = await stdout;
      const json = JSON.parse(out); // this would throw making the test fail if the JSON was invalid
      expect(json).toMatchSnapshot("bun-audit-expect-valid-json-stdout-report-no-vulnerabilities");
    },
  });

  doAuditTest("should print valid JSON and exit 1 when --json is passed and there are vulnerabilities", {
    exitCode: 1,
    files: fixture("express@3"),
    args: ["--json"],
    fn: async ({ stdout }) => {
      const out = await stdout;
      const json = JSON.parse(out); // this would throw making the test fail if the JSON was invalid
      expect(json).toMatchSnapshot("bun-audit-expect-valid-json-stdout-report-vulnerabilities");
    },
  });

  doAuditTest(
    "should exit 1 and behave exactly the same when there are vulnerabilities when only devDependencies are specified",
    {
      exitCode: 1,
      files: fixture("vuln-with-only-dev-dependencies"),
      fn: async ({ stdout }) => {
        expect(await stdout).toMatchSnapshot("bun-audit-expect-vulnerabilities-found");
      },
    },
  );

  doAuditTest(
    "when a project has some safe dependencies and some vulnerable dependencies, we should not print the safe dependencies",
    {
      exitCode: 1,
      files: fixture("mix-of-safe-and-vulnerable-dependencies"),
      fn: async ({ stdout }) => {
        // this fixture is using a safe version of is-number and an unsafe version of ms
        // so we want to check that `is-number` is not included in the output and that `ms` is

        const out = await stdout;

        expect(out).toContain("ms");
        expect(out).not.toContain("is-number");

        expect(out).toMatchSnapshot("bun-audit-expect-vulnerabilities-found");
      },
    },
  );

  const fakeIntegrity = // this is just random/fake data as the integrity check is not important for this test
    "sha512-V8E0l1jyyeSSS9R+J9oljx5eq2rqzClInuwaPcyuv0Mm3ViI/3/rcc4rCEO8i4eQ4I0O0FAGYDA2i5xWHHPhzg==";

  doAuditTest(
    "packages that come from non-default registries should be ignored from the audit, however they should get surfaced at the bottom of the output that they got skipped",
    {
      exitCode: 0,
      files: {
        "package.json": JSON.stringify({
          name: "test",
          version: "1.0.0",
          dependencies: {
            "@foo/bar": "1.0.0",
            "@foo/baz": "1.0.0",
          },
        }),
        "bun.lock": JSON.stringify({
          "lockfileVersion": 1,
          "workspaces": {
            "": {
              "name": "test",
            },
          },
          "packages": {
            "@foo/bar": ["@foo/bar@1.0.0", "", {}, fakeIntegrity],
            "@foo/baz": ["@foo/baz@1.0.0", "", {}, fakeIntegrity],
          },
        }),
        //prettier-ignore
        ".npmrc": [
          `registry=https://registry.npmjs.org`,
          `@foo:registry=https://my-registry.example.com`,
        ].join("\n"),
      },
      fn: async ({ stdout }) => {
        const out = await stdout;

        expect(out).toContain("Skipped @foo/bar, @foo/baz because they do not come from the default registry");
        expect(out).toContain("No vulnerabilities found");
      },
    },
  );

  doAuditTest("workspaces print the path to the vulnerable package and include workspace:pkg in the name", {
    exitCode: 1,
    files: {
      "package.json": JSON.stringify({
        name: "test",
        version: "1.0.0",
        workspaces: ["a"],
      }),

      "a/package.json": JSON.stringify({
        "name": "a",
        "dependencies": {
          "ms": "0.7.0",
        },
      }),

      "bun.lock": JSON.stringify({
        "lockfileVersion": 1,
        "workspaces": {
          "": {
            "name": "bun-audit-playground",
          },
          "a": {
            "name": "a",
            "dependencies": {
              "ms": "0.7.0",
            },
          },
        },
        "packages": {
          "a": ["a@workspace:a"],
          "ms": ["ms@0.7.0", "", {}, fakeIntegrity],
        },
      }),
    },
    fn: async ({ stdout }) => {
      expect(await stdout).toInclude("workspace:a › ms");
    },
  });

  doAuditTest("--audit-level critical only shows critical vulnerabilities", {
    exitCode: 1,
    files: fixture("express@3"),
    args: ["--audit-level", "critical"],
    fn: async ({ stdout, stderr }) => {
      expect(await stderr).not.toContain("invalid `--audit-level` value");
      const output = await stdout;
      expect(output).toContain("critical:");
      expect(output).not.toContain("moderate:");
      expect(output).not.toContain("high:");
      expect(output).not.toContain("low:");
    },
  });

  doAuditTest("--audit-level validates input and rejects invalid levels", {
    exitCode: 1,
    files: fixture("safe-is-number@7"),
    args: ["--audit-level", "invalid"],
    fn: async ({ stderr }) => {
      expect(await stderr).toContain("invalid `--audit-level` value");
      expect(await stderr).toContain("Valid values are: low, moderate, high, critical");
    },
  });

  doAuditTest("--audit-level accepts all valid severity levels", {
    exitCode: 0,
    files: fixture("safe-is-number@7"),
    args: ["--audit-level", "moderate"],
    fn: async ({ stdout, stderr }) => {
      expect(await stderr).not.toContain("invalid `--audit-level` value");
      expect(await stdout).toContain("No vulnerabilities found");
    },
  });

  doAuditTest("--prod flag is recognized and doesn't cause errors", {
    exitCode: 1,
    files: fixture("mix-of-safe-and-vulnerable-dependencies"),
    args: ["--prod"],
    fn: async ({ stdout, stderr }) => {
      expect(await stderr).not.toContain("error");
      expect(await stdout).toContain("vulnerabilities");
    },
  });

  doAuditTest("--ignore flag filters out specific CVE IDs", {
    exitCode: 1,
    files: fixture("express@3"),
    args: ["--ignore", "GHSA-gwg9-rgvj-4h5j"],
    fn: async ({ stdout, stderr }) => {
      expect(await stderr).not.toContain("error");
      const output = await stdout;
      expect(output).not.toContain("GHSA-gwg9-rgvj-4h5j");
      expect(output).toContain("vulnerabilities");
    },
  });

  test("sends a well-formed JSON request body when a package name contains a double quote", async () => {
    const packageName = 'a"b';
    using dirHandle = tempDir("bun-test-audit-name-with-quote", {
      "package.json": JSON.stringify({
        name: "test",
        version: "1.0.0",
        dependencies: {
          [packageName]: "1.0.0",
        },
      }),
      "bun.lock": JSON.stringify({
        "lockfileVersion": 1,
        "workspaces": {
          "": {
            "name": "test",
            "dependencies": {
              [packageName]: "1.0.0",
            },
          },
        },
        "packages": {
          [packageName]: [`${packageName}@1.0.0`, "", {}, fakeIntegrity],
        },
      }),
    });
    const dir = String(dirHandle);

    let receivedBody = "";
    await using auditServer = Bun.serve({
      port: 0,
      fetch: async req => {
        receivedBody = Buffer.from(Bun.gunzipSync(await req.arrayBuffer())).toString("utf-8");
        return Response.json({});
      },
    });

    await using proc = spawn({
      cmd: [bunExe(), "audit"],
      stdout: "pipe",
      stderr: "pipe",
      cwd: dir,
      env: {
        ...bunEnv,
        NPM_CONFIG_REGISTRY: auditServer.url.href,
      },
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(JSON.parse(receivedBody)).toEqual({ [packageName]: ["1.0.0"] });
    expect(stdout).toBe("No vulnerabilities found\n");
    expect(exitCode).toBe(0);
  });
});

describe("`bun audit --prod`", () => {
  // pnpm#13605: an optional peer that only a devDependency brought in is not a production dependency.
  test.concurrent("bun audit --prod skips a dev-only optional peer of a production package", async () => {
    await using server = startRegistry({ "no-deps": [adv("<1.0.1")] });
    using dir = await setup(server, {
      name: "foo",
      dependencies: { "one-optional-peer-dep": "1.0.2" },
      devDependencies: { "no-deps": "1.0.0" },
    });
    expect(await lock(dir)).toContain('"no-deps@1.0.0"');

    const all = await audit(dir);
    expect(all.stdout).toContain("no-deps");
    expect(all.exitCode).toBe(1);

    const prod = await audit(dir, "--prod");
    expect(prod.stdout).toBe("No vulnerabilities found\n");
    expect(prod.exitCode).toBe(0);
  });

  // pnpm#13605: production status is per installed version, not per name.
  test.concurrent(
    "bun audit --prod skips a dev-only version of a name that is also a production dependency",
    async () => {
      await using server = startRegistry({ "no-deps": [adv("<1.0.1")] });
      using dir = await setup(server, {
        name: "foo",
        dependencies: { "one-dep": "1.0.0" },
        devDependencies: { "no-deps": "1.0.0" },
      });
      const lockfile = await lock(dir);
      expect(lockfile).toContain('"no-deps@1.0.0"');
      expect(lockfile).toContain('"no-deps@1.0.1"');

      const all = await audit(dir);
      expect(all.stdout).toContain("no-deps");
      expect(all.exitCode).toBe(1);

      const prod = await audit(dir, "--prod");
      expect(prod.stdout).toBe("No vulnerabilities found\n");
      expect(prod.exitCode).toBe(0);
    },
  );

  test.concurrent(
    "bun audit --prod still reports the production version of a name that also has a dev version",
    async () => {
      await using server = startRegistry({ "no-deps": [adv("1.0.1")] });
      using dir = await setup(server, {
        name: "foo",
        dependencies: { "one-dep": "1.0.0" },
        devDependencies: { "no-deps": "1.0.0" },
      });

      const prod = await audit(dir, "--prod");
      expect(prod.stdout).toContain("no-deps");
      expect(prod.stdout).toContain("1 vulnerabilities (1 high)");
      expect(prod.exitCode).toBe(1);
    },
  );
});

describe("`bun audit fix`", () => {
  test.concurrent("fixes a direct dependency to the lowest safe version, not the newest", async () => {
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")] });
    using dir = await setupVulnerableADep(server);
    const pkgJsonBefore = await file(join(dir, "package.json")).text();

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(stdout).toContain("a-dep@1.0.2 → 1.0.4");
    expect(stdout).toContain("Fixed 1 vulnerability in 1 package");
    expect(stdout).not.toContain("remaining");
    expect(stderr).toContain("Saved lockfile");
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    const lockfile = await lock(dir);
    expect(lockfile).toContain('"a-dep@1.0.4"');
    expect(lockfile).not.toContain('"a-dep@1.0.2"');
    expect(lockfile).not.toContain('"a-dep@1.0.10"');
    expect(await installedVersion(dir, "a-dep")).toBe("1.0.4");
    expect(await file(join(dir, "package.json")).text()).toBe(pkgJsonBefore);

    const recheck = await audit(dir);
    expect(recheck.stdout).toBe("No vulnerabilities found\n");
    expect(recheck.exitCode).toBe(0);

    await runBunInstall(installEnv(dir), dir, { frozenLockfile: true });
  });

  test.concurrent("fixes a transitive dependency and leaves its dependent alone", async () => {
    await using server = startRegistry({ "no-deps": [adv("<1.0.1")] });
    using dir = await setup(server, { name: "foo", dependencies: { "one-range-dep": "1.0.0", "no-deps": "1.0.0" } });
    await reinstall(dir, { name: "foo", dependencies: { "one-range-dep": "1.0.0" } });
    let lockfile = await lock(dir);
    expect(lockfile).toContain('"no-deps@1.0.0"');
    expect(lockfile).not.toContain('"no-deps@1.1.0"');

    const { stdout, exitCode } = await auditFix(dir);
    expect(stdout).toContain("no-deps@1.0.0 → 1.0.1");
    expect(stdout).toContain("Fixed 1 vulnerability in 1 package");
    expect(exitCode).toBe(0);

    lockfile = await lock(dir);
    expect(lockfile).toContain('"one-range-dep@1.0.0"');
    expect(lockfile).toContain('"no-deps@1.0.1"');
    expect(lockfile).not.toContain('"no-deps@1.0.0"');
    expect(await installedVersion(dir, "no-deps")).toBe("1.0.1");

    await runBunInstall(installEnv(dir), dir, { frozenLockfile: true });
  });

  test.concurrent("reports a fix that would violate a dependent's range and changes nothing", async () => {
    await using server = startRegistry({ "no-deps": [adv("<1.1.0")] });
    using dir = await setup(server, { name: "foo", dependencies: { "one-dep": "1.0.0" } });
    const lockBefore = await lock(dir);
    expect(lockBefore).toContain('"no-deps@1.0.1"');

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "requires a semver-major update:
        no-deps@1.0.1 → 1.1.0
          one-dep@1.0.0 depends on no-deps@1.0.1

      No fixable vulnerabilities
      1 vulnerability remaining"
    `);
    expect(stderr).not.toContain("Saved lockfile");
    expect(exitCode).toBe(1);
    expect(await lock(dir)).toBe(lockBefore);
  });

  test.concurrent("--dry-run prints the plan and writes nothing", async () => {
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")] });
    using dir = await setupVulnerableADep(server);
    const lockBefore = await lock(dir);

    const { stdout, stderr, exitCode } = await auditFix(dir, "--dry-run");
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "fixing:
        a-dep@1.0.2 → 1.0.4

      Would fix 1 vulnerability in 1 package"
    `);
    expect(stderr).not.toContain("Saved lockfile");
    expect(exitCode).toBe(0);
    expect(await lock(dir)).toBe(lockBefore);
    expect(await installedVersion(dir, "a-dep")).toBe("1.0.2");
  });

  test.concurrent("no fix available", async () => {
    await using server = startRegistry({ "no-deps": [adv(">=2.0.0")] });
    using dir = await setup(server, { name: "foo", dependencies: { "no-deps": "^2.0.0" } });
    const lockBefore = await lock(dir);
    expect(lockBefore).toContain('"no-deps@2.0.0"');

    const { stdout, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "no fix available:
        no-deps@2.0.0

      No fixable vulnerabilities
      1 vulnerability remaining"
    `);
    expect(exitCode).toBe(1);
    expect(await lock(dir)).toBe(lockBefore);
  });

  test.concurrent("no vulnerabilities", async () => {
    await using server = startRegistry({});
    using dir = await setup(server, { name: "foo", dependencies: { "no-deps": "1.0.0" } });
    const lockBefore = await lock(dir);

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(stdout).toBe("No vulnerabilities found\n");
    expect(stderr).toContain("bun audit fix v");
    expect(exitCode).toBe(0);
    expect(await lock(dir)).toBe(lockBefore);
  });

  test.concurrent("peer dependency edges constrain the fix and are re-pointed", async () => {
    await using server = startRegistry({ "no-deps": [adv("<1.0.1")] });
    using dir = await setup(server, { name: "foo", dependencies: { "peer-deps-fixed": "1.0.0", "no-deps": "1.0.0" } });
    await reinstall(dir, { name: "foo", dependencies: { "peer-deps-fixed": "1.0.0", "no-deps": "^1.0.0" } });
    let lockfile = await lock(dir);
    expect(lockfile).toContain('"no-deps@1.0.0"');
    expect(lockfile).toContain('"peer-deps-fixed@1.0.0"');

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(stdout).toContain("no-deps@1.0.0 → 1.0.1");
    expect(stderr).not.toContain("incorrect peer dependency");
    expect(exitCode).toBe(0);

    lockfile = await lock(dir);
    expect(lockfile).toContain('"no-deps@1.0.1"');
    expect(lockfile).not.toContain('"no-deps@1.0.0"');

    await runBunInstall(installEnv(dir), dir, { frozenLockfile: true });
  });

  test.concurrent("instances of the same package are planned independently", async () => {
    await using server = startRegistry({ "no-deps": [adv("<1.1.0")] });
    using dir = await setup(server, { name: "foo", dependencies: { "one-dep": "1.0.0", "no-deps": "1.0.0" } });
    await reinstall(dir, { name: "foo", dependencies: { "one-dep": "1.0.0", "no-deps": "^1.0.0" } });
    let lockfile = await lock(dir);
    expect(lockfile).toContain('"no-deps@1.0.0"');
    expect(lockfile).toContain('"no-deps@1.0.1"');

    const { stdout, exitCode } = await auditFix(dir);
    expect(stdout).toContain("fixing:");
    expect(stdout).toContain("no-deps@1.0.0 → 1.1.0");
    expect(stdout).toContain("requires a semver-major update:");
    expect(stdout).toContain("no-deps@1.0.1 → 1.1.0");
    expect(stdout).toContain("one-dep@1.0.0 depends on no-deps@1.0.1");
    // pnpm#10646: the advisory still applies to no-deps@1.0.1, so it is remaining, not fixed, and `bun audit` agrees.
    expect(stdout).toContain("Fixed 0 vulnerabilities in 1 package");
    expect(stdout).toContain("1 vulnerability remaining");
    expect(exitCode).toBe(1);

    lockfile = await lock(dir);
    expect(lockfile).toContain('"no-deps@1.1.0"');
    expect(lockfile).toContain('"no-deps@1.0.1"');
    expect(lockfile).not.toContain('"no-deps@1.0.0"');
    expect(await installedVersion(dir, "no-deps")).toBe("1.1.0");

    const recheck = await audit(dir);
    expect(recheck.stdout).toContain("1 vulnerabilities (1 high)");
    expect(recheck.exitCode).toBe(1);

    await runBunInstall(installEnv(dir), dir, { frozenLockfile: true });
  });

  // pnpm#10646: one advisory hitting two installed versions is one vulnerability, as `bun audit` counts it.
  test.concurrent("one advisory across two fixable versions counts once", async () => {
    await using server = startRegistry({ "no-deps": [adv("<1.1.0")] });
    const workspace = (name: string, range: string) => JSON.stringify({ name, dependencies: { "no-deps": range } });
    const root = { name: "root", workspaces: ["packages/*"] };
    using dir = await setup(server, root, {
      "packages/a/package.json": workspace("a", "1.0.0"),
      "packages/b/package.json": workspace("b", "1.0.1"),
    });
    await write(join(dir, "packages", "a", "package.json"), workspace("a", "1.0.0 || >=1.1.0"));
    await write(join(dir, "packages", "b", "package.json"), workspace("b", "^1.0.1"));
    await runBunInstall(installEnv(dir), dir);
    let lockfile = await lock(dir);
    expect(lockfile).toContain('"no-deps@1.0.0"');
    expect(lockfile).toContain('"no-deps@1.0.1"');

    const { stdout, exitCode } = await auditFix(dir);
    expect(stdout).toContain("fixing:\n  no-deps@1.0.0 → 1.1.0\n  no-deps@1.0.1 → 1.1.0\n");
    expect(stdout).toContain("Fixed 1 vulnerability in 1 package");
    expect(stdout).not.toContain("remaining");
    expect(exitCode).toBe(0);

    lockfile = await lock(dir);
    expect(lockfile).toContain('"no-deps@1.1.0"');
    expect(lockfile).not.toContain('"no-deps@1.0.0"');
    expect(lockfile).not.toContain('"no-deps@1.0.1"');

    const recheck = await audit(dir);
    expect(recheck.stdout).toBe("No vulnerabilities found\n");
    expect(recheck.exitCode).toBe(0);
  });

  // pnpm#8943: a patch release on the current line wins over the next major that the range would also allow.
  test.concurrent("prefers an in-line patch over a major that the range also allows", async () => {
    await using server = startRegistry({ "no-deps": [adv("<1.0.1")] });
    using dir = await setup(server, { name: "foo", dependencies: { "no-deps": "1.0.0" } });
    await reinstall(dir, { name: "foo", dependencies: { "no-deps": ">=1.0.0" } });
    expect(await lock(dir)).toContain('"no-deps@1.0.0"');

    const { stdout, exitCode } = await auditFix(dir);
    expect(stdout).toContain("no-deps@1.0.0 → 1.0.1");
    expect(exitCode).toBe(0);

    const lockfile = await lock(dir);
    expect(lockfile).toContain('"no-deps@1.0.1"');
    expect(lockfile).not.toContain('"no-deps@2.0.0"');
  });

  // pnpm#12651 / #13824: an advisory with no released fix must not invent a version or leave bun.lock unusable.
  test.concurrent("an advisory covering the newest release leaves a lockfile that still installs frozen", async () => {
    await using server = startRegistry({ "a-dep": [adv("<=1.0.10")] });
    using dir = await setup(server, { name: "foo", dependencies: { "a-dep": "^1.0.0" } });
    const lockBefore = await lock(dir);
    expect(lockBefore).toContain('"a-dep@1.0.10"');

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "no fix available:
        a-dep@1.0.10

      No fixable vulnerabilities
      1 vulnerability remaining"
    `);
    expect(stderr).not.toContain("Saved lockfile");
    expect(exitCode).toBe(1);
    expect(await lock(dir)).toBe(lockBefore);

    await runBunInstall(installEnv(dir), dir, { frozenLockfile: true });
  });

  // pnpm#11101: a workspace package sharing a name with an advised npm package is not audited.
  test.concurrent("a workspace package is never matched against an advisory for its name", async () => {
    await using server = startRegistry({ "no-deps": [adv("<1.0.1")] });
    using dir = await setup(
      server,
      { name: "root", workspaces: ["packages/*"] },
      { "packages/no-deps/package.json": JSON.stringify({ name: "no-deps", version: "1.0.0" }) },
    );
    const lockBefore = await lock(dir);
    expect(lockBefore).toContain('"no-deps@workspace:packages/no-deps"');

    const { stdout, exitCode } = await auditFix(dir);
    expect(stdout).toBe("No vulnerabilities found\n");
    expect(exitCode).toBe(0);
    expect(await lock(dir)).toBe(lockBefore);
  });

  // pnpm#10486 / #12487: a package kept alive only by a peer edge is still upgraded.
  test.concurrent("fixes a package reachable only through a peer dependency edge", async () => {
    await using server = startRegistry({ "no-deps": [adv("<1.0.1")] });
    using dir = await setup(server, { name: "foo", dependencies: { "peer-deps-fixed": "1.0.0", "no-deps": "1.0.0" } });
    await reinstall(dir, { name: "foo", dependencies: { "peer-deps-fixed": "1.0.0" } });
    let lockfile = await lock(dir);
    expect(lockfile).toContain('"no-deps@1.0.0"');
    expect(lockfile).not.toContain('"no-deps@1.1.0"');

    const { stdout, exitCode } = await auditFix(dir);
    expect(stdout).toContain("no-deps@1.0.0 → 1.0.1");
    expect(exitCode).toBe(0);

    lockfile = await lock(dir);
    expect(lockfile).toContain('"no-deps@1.0.1"');
    expect(lockfile).not.toContain('"no-deps@1.0.0"');

    await runBunInstall(installEnv(dir), dir, { frozenLockfile: true });
  });

  test.concurrent("honours catalog ranges", async () => {
    await using server = startRegistry({ "no-deps": [adv("<1.0.1")] });
    using dir = await setup(
      server,
      { name: "root", workspaces: ["packages/*"], catalog: { "no-deps": "1.0.0" } },
      { "packages/a/package.json": JSON.stringify({ name: "a", dependencies: { "no-deps": "catalog:" } }) },
    );
    await reinstall(dir, { name: "root", workspaces: ["packages/*"], catalog: { "no-deps": "^1.0.0" } });
    let lockfile = await lock(dir);
    expect(lockfile).toContain('"no-deps@1.0.0"');
    expect(lockfile).not.toContain('"no-deps@1.0.1"');

    const { stdout, exitCode } = await auditFix(dir);
    expect(stdout).toContain("no-deps@1.0.0 → 1.0.1");
    expect(exitCode).toBe(0);

    lockfile = await lock(dir);
    expect(lockfile).toContain('"no-deps@1.0.1"');
    expect(lockfile).not.toContain('"no-deps@1.0.0"');
  });

  test.concurrent("--ignore and --audit-level filter what gets fixed", async () => {
    await using server = startRegistry({ "a-dep": [{ ...adv("<1.0.4", 7), severity: "low" }] });
    using dir = await setupVulnerableADep(server);
    const lockBefore = await lock(dir);

    const ignored = await auditFix(dir, "--ignore", "7");
    expect(ignored.stdout).toBe("No vulnerabilities found\n");
    expect(ignored.exitCode).toBe(0);
    expect(await lock(dir)).toBe(lockBefore);

    const belowLevel = await auditFix(dir, "--audit-level", "high");
    expect(belowLevel.stdout).toBe("No vulnerabilities found\n");
    expect(belowLevel.exitCode).toBe(0);
    expect(await lock(dir)).toBe(lockBefore);

    const fixed = await auditFix(dir);
    expect(fixed.stdout).toContain("Fixed 1 vulnerability in 1 package");
    expect(fixed.exitCode).toBe(0);
    expect(await lock(dir)).toContain('"a-dep@1.0.4"');
  });

  test.concurrent("rejects --json and extra arguments", async () => {
    await using server = startRegistry({});
    using dir = await setup(server, { name: "foo", dependencies: { "no-deps": "1.0.0" } });
    const lockBefore = await lock(dir);

    const json = await auditFix(dir, "--json");
    expect(json.stderr).toContain("error: --json is not supported by bun audit fix");
    expect(json.exitCode).toBe(1);

    const extra = await auditFix(dir, "extra");
    expect(extra.stderr).toContain("error: bun audit fix does not take arguments");
    expect(extra.exitCode).toBe(1);

    expect(await lock(dir)).toBe(lockBefore);
  });

  test.concurrent("refuses to run against a frozen lockfile", async () => {
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")] });
    using dir = await setupVulnerableADep(server);
    const lockBefore = await lock(dir);

    for (const flag of ["--frozen-lockfile", "--production"]) {
      const { stderr, exitCode } = await auditFix(dir, flag);
      expect(stderr).toContain("error: bun audit fix needs to write bun.lock, but the lockfile is frozen");
      expect(exitCode).toBe(1);
      expect(await lock(dir)).toBe(lockBefore);
    }

    const dryRun = await auditFix(dir, "--frozen-lockfile", "--dry-run");
    expect(dryRun.stdout).toContain("Would fix 1 vulnerability in 1 package");
    expect(dryRun.exitCode).toBe(0);
    expect(await lock(dir)).toBe(lockBefore);
  });

  test.concurrent("an optional peer edge does not keep the vulnerable version alive", async () => {
    await using server = startRegistry({ "no-deps": [adv("<1.0.1")] });
    using dir = await setup(server, {
      name: "foo",
      dependencies: { "optional-peer-deps": "1.0.0", "no-deps": "1.0.0" },
    });
    await reinstall(dir, { name: "foo", dependencies: { "optional-peer-deps": "1.0.0", "no-deps": "^1.0.0" } });
    expect(await lock(dir)).toContain('"no-deps@1.0.0"');

    const { stdout, exitCode } = await auditFix(dir);
    expect(stdout).toContain("no-deps@1.0.0 → 1.0.1");
    expect(exitCode).toBe(0);

    const lockfile = await lock(dir);
    expect(lockfile).toContain('"no-deps@1.0.1"');
    expect(lockfile).not.toContain('"no-deps@1.0.0"');

    const recheck = await audit(dir);
    expect(recheck.stdout).toBe("No vulnerabilities found\n");
    expect(recheck.exitCode).toBe(0);

    await runBunInstall(installEnv(dir), dir, { frozenLockfile: true });
  });

  // The peer holder hoists before the dependent, so a slot still bound to the old version takes the root folder.
  test.concurrent(
    "an optional peer edge hoisted before the dependent does not keep the vulnerable version",
    async () => {
      await using server = startRegistry({ "no-deps": [adv("<1.0.1")] });
      using dir = await setup(server, {
        name: "foo",
        dependencies: { "one-optional-peer-dep": "1.0.2", "one-range-dep": "1.0.0", "no-deps": "1.0.0" },
      });
      await reinstall(dir, {
        name: "foo",
        dependencies: { "one-optional-peer-dep": "1.0.2", "one-range-dep": "1.0.0" },
      });
      expect(await lock(dir)).toContain('"no-deps@1.0.0"');

      const { stdout, exitCode } = await auditFix(dir);
      expect(stdout).toContain("no-deps@1.0.0 → 1.0.1");
      expect(stdout).toContain("Fixed 1 vulnerability in 1 package");
      expect(exitCode).toBe(0);

      const lockfile = await lock(dir);
      expect(lockfile).toContain('"no-deps": ["no-deps@1.0.1"');
      expect(lockfile).not.toContain('"no-deps@1.0.0"');
      expect(lockfile).not.toContain('"one-range-dep/no-deps"');
      expect(await installedVersion(dir, "no-deps")).toBe("1.0.1");

      const recheck = await audit(dir);
      expect(recheck.stdout).toBe("No vulnerabilities found\n");
      expect(recheck.exitCode).toBe(0);

      await runBunInstall(installEnv(dir), dir, { frozenLockfile: true });
    },
  );

  test.concurrent("an advisory for an installed prerelease is matched and reported", async () => {
    await using server = startRegistry({}, { bulkResponse: { "no-deps-backward-tags": [adv("<1.1.0")] } });
    using dir = await setup(server, { name: "foo", dependencies: { "no-deps-backward-tags": "1.0.0-rc.1" } });
    const lockBefore = await lock(dir);
    expect(lockBefore).toContain('"no-deps-backward-tags@1.0.0-rc.1"');

    const { stdout, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "requires a semver-major update:
        no-deps-backward-tags@1.0.0-rc.1 → 1.1.0
          foo depends on no-deps-backward-tags@1.0.0-rc.1

      No fixable vulnerabilities
      1 vulnerability remaining"
    `);
    expect(exitCode).toBe(1);
    expect(await lock(dir)).toBe(lockBefore);
  });

  test.concurrent("advisories that match no installed version are listed, not just counted", async () => {
    await using server = startRegistry(
      {},
      { bulkResponse: { "no-deps": [adv(">=5.0.0"), adv(">=5.0.0", 2), adv("not a range", 3)] } },
    );
    using dir = await setup(server, { name: "foo", dependencies: { "no-deps": "1.0.0" } });
    const lockBefore = await lock(dir);

    const { stdout, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "not matched to an installed version:
        no-deps@>=5.0.0
        no-deps@not a range

      No fixable vulnerabilities
      3 vulnerabilities remaining"
    `);
    expect(exitCode).toBe(1);
    expect(await lock(dir)).toBe(lockBefore);
  });

  test.concurrent("an unparsable advisory does not hide a real fix for the same package", async () => {
    await using server = startRegistry({}, { bulkResponse: { "a-dep": [adv("<1.0.4"), adv("not a range", 2)] } });
    using dir = await setupVulnerableADep(server);

    const { stdout, exitCode } = await auditFix(dir);
    expect(stdout).toContain("a-dep@1.0.2 → 1.0.4");
    expect(stdout).toContain("a-dep@not a range");
    expect(stdout).toContain("Fixed 1 vulnerability in 1 package");
    expect(stdout).toContain("1 vulnerability remaining");
    expect(exitCode).toBe(1);
    expect(await lock(dir)).toContain('"a-dep@1.0.4"');
  });

  test.concurrent("a bundled dependency is never claimed as fixed", async () => {
    await using server = startRegistry({ "no-deps": [adv("<1.0.1")] });
    using dir = await setup(server, { name: "foo", dependencies: { "bundled-1": "1.0.0" } });
    const lockBefore = await lock(dir);
    expect(lockBefore).toContain('"no-deps@1.0.0"');

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "requires a semver-major update:
        no-deps@1.0.0 → 1.0.1
          bundled-1@1.0.0 bundles no-deps@1.0.0

      No fixable vulnerabilities
      1 vulnerability remaining"
    `);
    expect(stderr).not.toContain("Saved lockfile");
    expect(exitCode).toBe(1);
    expect(await lock(dir)).toBe(lockBefore);
    expect(await installedVersion(dir, "bundled-1", "node_modules", "no-deps")).toBe("1.0.0");
  });

  test.concurrent("multiple advisories on one instance are cleared together", async () => {
    await using server = startRegistry({ "a-dep": [adv("<1.0.4", 1), adv("<1.0.6", 2)] });
    using dir = await setupVulnerableADep(server);

    const { stdout, exitCode } = await auditFix(dir);
    expect(stdout).toContain("a-dep@1.0.2 → 1.0.6");
    expect(stdout).toContain("Fixed 2 vulnerabilities in 1 package");
    expect(stdout).not.toContain("remaining");
    expect(exitCode).toBe(0);

    const lockfile = await lock(dir);
    expect(lockfile).toContain('"a-dep@1.0.6"');
    expect(lockfile).not.toContain('"a-dep@1.0.4"');

    const recheck = await audit(dir);
    expect(recheck.stdout).toBe("No vulnerabilities found\n");
    expect(recheck.exitCode).toBe(0);
  });

  // pnpm fixtures/update-multiple: two advisories for one name with disjoint ranges.
  test.concurrent("disjoint advisory ranges for one package are all avoided", async () => {
    await using server = startRegistry({ "no-deps": [adv(">=1.0.0 <1.0.1", 1), adv(">=1.1.0 <2.0.0", 2)] });
    using dir = await setup(server, { name: "foo", dependencies: { "no-deps": "1.0.0" } });
    await reinstall(dir, { name: "foo", dependencies: { "no-deps": ">=1.0.0" } });
    expect(await lock(dir)).toContain('"no-deps@1.0.0"');

    const { stdout, exitCode } = await auditFix(dir);
    expect(stdout).toContain("no-deps@1.0.0 → 1.0.1");
    expect(stdout).toContain("Fixed 1 vulnerability in 1 package");
    expect(exitCode).toBe(0);
    expect(await lock(dir)).toContain('"no-deps@1.0.1"');
  });

  // pnpm fixtures/update-single-depth-2/responses/unfixable-vulnerability.json: npm-style advisory objects carry
  // fields (findings, patched_versions, ...) that must be ignored, and `>=0.0.0` is unfixable.
  test.concurrent("ignores unknown advisory fields and treats >=0.0.0 as unfixable", async () => {
    await using server = startRegistry(
      {},
      {
        bulkResponse: {
          "no-deps": [
            {
              ...adv(">=0.0.0", 1234),
              findings: [{ version: "1.0.0", paths: ["no-deps"] }],
              patched_versions: "<0.0.0",
              recommendation: "None",
              cwe: ["CWE-1"],
              cvss: { score: 0, vectorString: null },
            },
          ],
        },
      },
    );
    using dir = await setup(server, { name: "foo", dependencies: { "no-deps": "^1.0.0" } });
    const lockBefore = await lock(dir);

    const { stdout, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "no fix available:
        no-deps@1.1.0

      No fixable vulnerabilities
      1 vulnerability remaining"
    `);
    expect(exitCode).toBe(1);
    expect(await lock(dir)).toBe(lockBefore);
  });

  // Ported verbatim from pnpm's test/audit/utils/responses/all-vulnerabilities-response.json (51 packages, 111 advisories).
  test.concurrent("parses a real bulk response and only plans installed packages", async () => {
    const bulkResponse = await file(
      join(import.meta.dir, "registry/fixtures/audit/pnpm-all-vulnerabilities-response.json"),
    ).json();
    await using server = startRegistry({}, { bulkResponse });
    using dir = await setup(server, { name: "foo", dependencies: { "no-deps": "1.0.0" } });
    const lockBefore = await lock(dir);

    const { stdout, exitCode } = await auditFix(dir);
    expect(stdout).not.toContain("fixing:");
    expect(stdout).not.toContain("no-deps");
    expect(stdout).toContain("not matched to an installed version:");
    expect(stdout).toContain("  axios@<0.21.2\n");
    expect(stdout).toContain("  semver@>=2.0.0-alpha <5.7.2\n");
    expect(stdout).toContain("111 vulnerabilities remaining");
    expect(exitCode).toBe(1);
    expect(await lock(dir)).toBe(lockBefore);
  });

  test.concurrent("fixes two packages in one run and leaves the rest of the lockfile alone", async () => {
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")], "no-deps": [adv("<1.0.1", 2)] });
    using dir = await setup(server, {
      name: "foo",
      dependencies: { "a-dep": "1.0.2", "one-range-dep": "1.0.0", "no-deps": "1.0.0", "@types/is-number": "1.0.0" },
    });
    await reinstall(dir, {
      name: "foo",
      dependencies: { "a-dep": "^1.0.2", "one-range-dep": "1.0.0", "@types/is-number": "1.0.0" },
    });
    const lockBefore = await lock(dir);
    expect(lockBefore).toContain('"a-dep@1.0.2"');
    expect(lockBefore).toContain('"no-deps@1.0.0"');

    const { stdout, exitCode } = await auditFix(dir);
    expect(stdout).toContain("fixing:\n  a-dep@1.0.2 → 1.0.4\n  no-deps@1.0.0 → 1.0.1\n");
    expect(stdout).toContain("Fixed 2 vulnerabilities in 2 packages");
    expect(exitCode).toBe(0);

    const lockAfter = await lock(dir);
    const packageRows = lockBefore.split("\n").filter(line => /^    "[^"]+": \["/.test(line));
    const untouched = packageRows.filter(line => !line.includes('"a-dep@') && !line.includes('"no-deps@'));
    expect(untouched.map(line => line.split('"')[1]).sort()).toEqual(["@types/is-number", "one-range-dep"]);
    for (const line of untouched) expect(lockAfter).toContain(line);
    expect(lockAfter).toContain('"a-dep@1.0.4"');
    expect(lockAfter).toContain('"no-deps@1.0.1"');
  });

  test.concurrent("fixes a scoped package", async () => {
    await using server = startRegistry({ "@types/is-number": [adv("<2.0.0")] });
    using dir = await setup(server, { name: "foo", dependencies: { "@types/is-number": "1.0.0" } });
    await reinstall(dir, { name: "foo", dependencies: { "@types/is-number": ">=1.0.0" } });
    expect(await lock(dir)).toContain('"@types/is-number@1.0.0"');

    const { stdout, exitCode } = await auditFix(dir);
    expect(stdout).toContain("@types/is-number@1.0.0 → 2.0.0");
    expect(exitCode).toBe(0);

    const lockfile = await lock(dir);
    expect(lockfile).toContain('"@types/is-number@2.0.0"');
    expect(lockfile).not.toContain('"@types/is-number@1.0.0"');
    expect(await installedVersion(dir, "@types", "is-number")).toBe("2.0.0");
  });

  test.concurrent("fixes an npm: alias pointing at a vulnerable package", async () => {
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")] });
    using dir = await setup(server, { name: "foo", dependencies: { nd: "npm:a-dep@1.0.2" } });
    await reinstall(dir, { name: "foo", dependencies: { nd: "npm:a-dep@^1.0.2" } });
    expect(await lock(dir)).toContain('"a-dep@1.0.2"');

    const { stdout, exitCode } = await auditFix(dir);
    expect(stdout).toContain("a-dep@1.0.2 → 1.0.4");
    expect(exitCode).toBe(0);

    const lockfile = await lock(dir);
    expect(lockfile).toContain('"a-dep@1.0.4"');
    expect(lockfile).not.toContain('"a-dep@1.0.2"');
    expect(await installedVersion(dir, "nd")).toBe("1.0.4");

    await runBunInstall(installEnv(dir), dir, { frozenLockfile: true });
  });

  test.concurrent("an overrides pin is reported as the blocker", async () => {
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")] });
    using dir = await setup(server, {
      name: "foo",
      dependencies: { "a-dep": "^1.0.2" },
      overrides: { "a-dep": "1.0.2" },
    });
    const lockBefore = await lock(dir);
    expect(lockBefore).toContain('"a-dep@1.0.2"');

    const { stdout, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "requires a semver-major update:
        a-dep@1.0.2 → 1.0.4
          foo depends on a-dep@1.0.2

      No fixable vulnerabilities
      1 vulnerability remaining"
    `);
    expect(exitCode).toBe(1);
    expect(await lock(dir)).toBe(lockBefore);
  });

  // pnpm fixtures/update-workspace-catalog-pinned: a pinned catalog entry blocks the fix.
  test.concurrent("a pinned catalog entry is reported as the blocker", async () => {
    await using server = startRegistry({ "no-deps": [adv("<1.0.1")] });
    using dir = await setup(
      server,
      { name: "root", workspaces: ["packages/*"], catalog: { "no-deps": "1.0.0" } },
      { "packages/a/package.json": JSON.stringify({ name: "a", dependencies: { "no-deps": "catalog:" } }) },
    );
    const lockBefore = await lock(dir);
    expect(lockBefore).toContain('"no-deps@1.0.0"');

    const { stdout, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "requires a semver-major update:
        no-deps@1.0.0 → 1.0.1
          a depends on no-deps@1.0.0

      No fixable vulnerabilities
      1 vulnerability remaining"
    `);
    expect(exitCode).toBe(1);
    expect(await lock(dir)).toBe(lockBefore);
  });

  // mismatched-peer-deps-lvl1 declares peer no-deps@<=1.0.1; its own dependency lvl2 declares peer no-deps@1.0.0,
  // so the installs warn about an incorrect peer and cannot go through runBunInstall.
  test.concurrent("a peer range is a blocker and is labelled with the peer dependent", async () => {
    await using server = startRegistry({ "no-deps": [adv("<=1.0.1")] });
    const pkgJson = (noDeps: string) =>
      JSON.stringify({ name: "foo", dependencies: { "mismatched-peer-deps-lvl1": "1.0.0", "no-deps": noDeps } });
    using dir = tempDir("audit-fix-", { "package.json": pkgJson("1.0.1") });
    await writeBunfig(dir, server);
    expect((await run(dir, ["install"])).exitCode).toBe(0);
    await write(join(dir, "package.json"), pkgJson("^1.0.0"));
    expect((await run(dir, ["install"])).exitCode).toBe(0);
    const lockBefore = await lock(dir);
    expect(lockBefore).toContain('"no-deps@1.0.1"');

    const { stdout, exitCode } = await auditFix(dir);
    expect(stdout).toContain("no-deps@1.0.1 → 1.1.0");
    expect(stdout).toContain("mismatched-peer-deps-lvl1@1.0.0 depends on no-deps@<=1.0.1");
    expect(stdout).not.toContain("foo depends on");
    expect(exitCode).toBe(1);
    expect(await lock(dir)).toBe(lockBefore);
  });

  test.concurrent("a depth-3 blocker names the immediate dependent", async () => {
    await using server = startRegistry({ "no-deps": [adv("<1.1.0")] });
    using dir = await setup(server, { name: "foo", dependencies: { "one-one-dep": "1.0.0" } });
    const lockBefore = await lock(dir);
    expect(lockBefore).toContain('"no-deps@1.0.1"');

    const { stdout, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "requires a semver-major update:
        no-deps@1.0.1 → 1.1.0
          one-dep@1.0.0 depends on no-deps@1.0.1

      No fixable vulnerabilities
      1 vulnerability remaining"
    `);
    expect(exitCode).toBe(1);
    expect(await lock(dir)).toBe(lockBefore);
  });

  // Workspaces default to the isolated linker, so the linker is pinned to keep node_modules paths predictable.
  test.concurrent("fixes a workspace member's dependency when run from the member directory", async () => {
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")] });
    const member = (range: string) => JSON.stringify({ name: "a", dependencies: { "a-dep": range } });
    const rootPkgJson = JSON.stringify({ name: "root", workspaces: ["packages/*"] });
    using dir = tempDir("audit-fix-", { "package.json": rootPkgJson, "packages/a/package.json": member("1.0.2") });
    await writeBunfig(dir, server);
    expect((await run(dir, ["install", "--linker", "hoisted"])).exitCode).toBe(0);
    await write(join(dir, "packages", "a", "package.json"), member("^1.0.2"));
    expect((await run(dir, ["install", "--linker", "hoisted"])).exitCode).toBe(0);
    expect(await lock(dir)).toContain('"a-dep@1.0.2"');

    const { stdout, exitCode } = await run(join(dir, "packages", "a"), ["audit", "fix", "--linker", "hoisted"], dir);
    expect(stdout).toContain("a-dep@1.0.2 → 1.0.4");
    expect(exitCode).toBe(0);

    const lockfile = await lock(dir);
    expect(lockfile).toContain('"a-dep@1.0.4"');
    expect(lockfile).not.toContain('"a-dep@1.0.2"');
    expect(await exists(join(dir, "packages", "a", "bun.lock"))).toBeFalse();
    expect(await file(join(dir, "package.json")).text()).toBe(rootPkgJson);
    expect(await file(join(dir, "packages", "a", "package.json")).text()).toBe(member("^1.0.2"));
    expect(await installedVersion(dir, "a-dep")).toBe("1.0.4");

    const frozen = await run(dir, ["install", "--frozen-lockfile", "--linker", "hoisted"]);
    expect(frozen.stderr).not.toContain("error:");
    expect(frozen.exitCode).toBe(0);
  });

  // `--linker isolated` is passed explicitly: an `install-strategy` in the user's ~/.npmrc overrides the bunfig linker.
  test.concurrent("isolated linker layout", async () => {
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")] });
    using dir = tempDir("audit-fix-", {
      "package.json": JSON.stringify({ name: "foo", dependencies: { "a-dep": "1.0.2" } }),
    });
    await writeBunfig(dir, server);
    expect((await run(dir, ["install", "--linker", "isolated"])).exitCode).toBe(0);
    await write(join(dir, "package.json"), JSON.stringify({ name: "foo", dependencies: { "a-dep": "^1.0.2" } }));
    expect((await run(dir, ["install", "--linker", "isolated"])).exitCode).toBe(0);
    expect(await lock(dir)).toContain('"a-dep@1.0.2"');
    expect(await readlink(join(dir, "node_modules", "a-dep"))).toContain("a-dep@1.0.2");

    const { stdout, exitCode } = await auditFix(dir, "--linker", "isolated");
    expect(stdout).toContain("Fixed 1 vulnerability in 1 package");
    expect(exitCode).toBe(0);

    expect(await lock(dir)).toContain('"a-dep@1.0.4"');
    expect(await readlink(join(dir, "node_modules", "a-dep"))).toContain("a-dep@1.0.4");
    expect(await installedVersion(dir, "a-dep")).toBe("1.0.4");

    const frozen = await run(dir, ["install", "--frozen-lockfile", "--linker", "isolated"]);
    expect(frozen.stderr).not.toContain("error:");
    expect(frozen.exitCode).toBe(0);
  });

  // Every a-dep release was published in 2023, so a 100-year minimum age gates all of them.
  test.concurrent("a fix gated by --minimum-release-age is reported distinctly", async () => {
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")] });
    using dir = await setupVulnerableADep(server);
    const lockBefore = await lock(dir);

    const gated = await auditFix(dir, "--minimum-release-age", "3153600000");
    expect(normalizeBunSnapshot(gated.stdout)).toMatchInlineSnapshot(`
      "no fix available:
        a-dep@1.0.2 (1.0.4 is newer than --minimum-release-age)

      No fixable vulnerabilities
      1 vulnerability remaining"
    `);
    expect(gated.exitCode).toBe(1);
    expect(await lock(dir)).toBe(lockBefore);

    const fixed = await auditFix(dir, "--minimum-release-age", "60");
    expect(fixed.stdout).toContain("a-dep@1.0.2 → 1.0.4");
    expect(fixed.exitCode).toBe(0);
    expect(await lock(dir)).toContain('"a-dep@1.0.4"');
  });

  test.concurrent("a failing bulk endpoint changes nothing", async () => {
    await using server = startRegistry({}, { bulkStatus: 500 });
    using dir = await setupVulnerableADep(server);
    const lockBefore = await lock(dir);

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(stdout).not.toContain("fixing:");
    expect(stderr).toContain("audit request failed");
    expect(exitCode).toBe(1);
    expect(await lock(dir)).toBe(lockBefore);
  });

  test.concurrent("a manifest that fails to download is reported, not fixed", async () => {
    const denyManifests = new Set<string>();
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")] }, { denyManifests });
    using dir = await setupVulnerableADep(server);
    const lockBefore = await lock(dir);
    denyManifests.add("a-dep");

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "no fix available:
        a-dep@1.0.2 (failed to fetch the manifest)

      No fixable vulnerabilities
      1 vulnerability remaining"
    `);
    expect(stderr).toContain("a-dep");
    expect(stderr).not.toContain("Saved lockfile");
    expect(exitCode).toBe(1);
    expect(await lock(dir)).toBe(lockBefore);
  });

  test.concurrent("refuses to run without a lockfile", async () => {
    await using server = startRegistry({});
    using dir = tempDir("audit-fix-", {
      "package.json": JSON.stringify({ name: "foo" }),
      "bunfig.toml": Bun.TOML.stringify({ install: { registry: server.url.href } }),
    });

    const { stderr, exitCode } = await auditFix(dir);
    expect(stderr).toContain("Lockfile not found");
    expect(exitCode).toBe(1);
    expect(await exists(join(dir, "bun.lock"))).toBeFalse();
  });

  test.concurrent("refuses --no-save before contacting the registry", async () => {
    await using server = startRegistry({}, { bulkStatus: 500 });
    using dir = await setupVulnerableADep(server);
    const lockBefore = await lock(dir);

    const { stdout, stderr, exitCode } = await auditFix(dir, "--no-save");
    expect(stderr).toContain("error: bun audit fix needs to write bun.lock, but saving the lockfile is disabled");
    expect(stderr).not.toContain("audit request failed");
    expect(stdout).not.toContain("Fixed");
    expect(exitCode).toBe(1);
    expect(await lock(dir)).toBe(lockBefore);
  });
});
