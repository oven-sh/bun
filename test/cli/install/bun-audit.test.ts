import { file, spawn, write } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { exists, readlink } from "fs/promises";
import {
  DirectoryTree,
  VerdaccioRegistry,
  bunEnv,
  bunExe,
  gunzipJsonRequest,
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

    await using proc = spawn({
      cmd,
      stdout: "pipe",
      stderr: "pipe",
      cwd: dir,
      env: {
        ...bunEnv,
        NPM_CONFIG_REGISTRY: url,
      },
    });

    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    try {
      await options.fn({ stdout: Promise.resolve(out), stderr: Promise.resolve(err), dir });
      expect(exitCode).toBe(options.exitCode);
    } catch (e) {
      console.log("ERR:", err);
      console.log("OUT:", out);
      throw e;
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
  // Tarball file names (`a-dep-1.0.4.tgz`) whose downloads answer 404.
  denyTarballs?: Set<string>;
  // Publish times overlaid on a package's manifest: { "a-dep": { "1.0.4": iso } }.
  rewriteTime?: Record<string, Record<string, string>>;
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

      const packageName = decodeURIComponent(url.pathname.slice(1));
      if (options.denyManifests?.has(packageName)) {
        return new Response("not found", { status: 404 });
      }
      if (options.denyTarballs?.has(url.pathname.slice(url.pathname.lastIndexOf("/") + 1))) {
        return new Response("not found", { status: 404 });
      }

      const up = await fetch(new URL(url.pathname + url.search, verdaccio.registryUrl()), {
        method: req.method,
        headers: { accept: req.headers.get("accept") ?? "*/*" },
      });
      const time = options.rewriteTime?.[packageName];
      if (time && up.ok) {
        const manifest = await up.json();
        manifest.time = { ...manifest.time, ...time };
        return Response.json(manifest);
      }
      return new Response(up.body, {
        status: up.status,
        headers: { "content-type": up.headers.get("content-type") ?? "application/octet-stream" },
      });
    },
  });
}

type Registry = ReturnType<typeof startRegistry>;

function registryHref(server: Registry) {
  return server.url.href.slice(0, -1);
}

function writeBunfig(dir: string, server: Registry, scopes?: Record<string, string>) {
  return write(
    join(dir, "bunfig.toml"),
    Bun.TOML.stringify({
      install: {
        cache: join(dir, ".bun-cache"),
        registry: server.url.href,
        saveTextLockfile: true,
        ...(scopes && { scopes }),
      },
    }),
  );
}

// The CI runner exports one BUN_INSTALL_CACHE_DIR per file, which overrides the bunfig cache the concurrent cases rely on.
function installEnv(dir: string) {
  return { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(dir, ".bun-cache") };
}

async function setup(
  server: Registry,
  pkgJson: object | string,
  extraFiles: Record<string, string> = {},
  scopes?: Record<string, string>,
) {
  const text = typeof pkgJson === "string" ? pkgJson : JSON.stringify(pkgJson);
  const dir = tempDir("audit-fix-", { "package.json": text, ...extraFiles });
  await writeBunfig(dir, server, scopes);
  await runBunInstall(installEnv(dir), dir);
  return dir;
}

function pkgJson(dir: string, ...segments: string[]) {
  return file(join(dir, ...segments, "package.json")).json();
}

function pkgJsonText(dir: string, ...segments: string[]) {
  return file(join(dir, ...segments, "package.json")).text();
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

// The version `dependent` resolves `name` to under the hoisted layout: its nested copy, else the root one.
async function resolvedVersion(dir: string, dependent: string, name: string) {
  if (await exists(join(dir, "node_modules", dependent, "node_modules", name))) {
    return installedVersion(dir, dependent, "node_modules", name);
  }
  return installedVersion(dir, name);
}

async function expectInstall(dir: string, ...args: string[]) {
  const { stderr, exitCode } = await run(dir, ["install", ...args]);
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);
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

  doAuditTest("--json exits 0 when --audit-level filters out every advisory, but still prints them all", {
    exitCode: 0,
    files: fixture("vuln-with-only-dev-dependencies"),
    args: ["--json", "--audit-level", "critical"],
    fn: async ({ stdout }) => {
      const json = JSON.parse(await stdout);
      expect(json.ms.map((a: { severity: string }) => a.severity).sort()).toEqual(["high", "moderate"]);
    },
  });

  doAuditTest("--json exits 0 when --ignore covers every advisory, but still prints them all", {
    exitCode: 0,
    files: fixture("vuln-with-only-dev-dependencies"),
    args: ["--json", "--ignore", "GHSA-w9mr-4mfr-499f", "--ignore", "GHSA-3fx5-fwvr-xrjg"],
    fn: async ({ stdout }) => {
      const json = JSON.parse(await stdout);
      expect(json.ms).toHaveLength(2);
    },
  });

  doAuditTest("--json still exits 1 when an advisory survives --audit-level and --ignore", {
    exitCode: 1,
    files: fixture("vuln-with-only-dev-dependencies"),
    args: ["--json", "--audit-level", "high", "--ignore", "GHSA-w9mr-4mfr-499f"],
    fn: async ({ stdout }) => {
      expect(JSON.parse(await stdout).ms).toHaveLength(2);
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
        // The fixture installs a safe is-number and a vulnerable ms.

        const out = await stdout;

        expect(out).toContain("ms");
        expect(out).not.toContain("is-number");

        expect(out).toMatchSnapshot("bun-audit-expect-vulnerabilities-found");
      },
    },
  );

  const fakeIntegrity = // this is just random/fake data as the integrity check is not important for this test
    "sha512-V8E0l1jyyeSSS9R+J9oljx5eq2rqzClInuwaPcyuv0Mm3ViI/3/rcc4rCEO8i4eQ4I0O0FAGYDA2i5xWHHPhzg==";

  function scopedRegistryProject(scoped: Registry) {
    return {
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
      ".npmrc": `@foo:registry=${scoped.url.href}`,
    };
  }

  async function auditWithDefaultRegistry(dir: string) {
    await using proc = spawn({
      cmd: [bunExe(), "audit"],
      stdout: "pipe",
      stderr: "pipe",
      cwd: dir,
      env: { ...bunEnv, NPM_CONFIG_REGISTRY: registryHref(server) },
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test("packages served by a scoped registry are audited against that registry", async () => {
    await using scoped = startRegistry({}, { bulkResponse: { "@foo/bar": [adv("<2.0.0")] } });
    using dir = tempDir("bun-test-audit-scoped-registry", scopedRegistryProject(scoped));

    const { stdout, exitCode } = await auditWithDefaultRegistry(String(dir));
    expect(stdout).toContain("@foo/bar");
    expect(stdout).toContain("1 vulnerability (1 high)");
    expect(stdout).not.toContain("Skipped");
    expect(exitCode).toBe(1);
  });

  test("packages whose scoped registry does not answer the audit request are listed as skipped", async () => {
    await using scoped = startRegistry({}, { bulkStatus: 404 });
    using dir = tempDir("bun-test-audit-scoped-registry-down", scopedRegistryProject(scoped));

    const { stdout, exitCode } = await auditWithDefaultRegistry(String(dir));
    expect(stdout).toContain(`Skipped @foo/bar, @foo/baz because ${registryHref(scoped)} could not be audited`);
    expect(stdout).toContain("No vulnerabilities found");
    expect(exitCode).toBe(0);
  });

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
      expect(prod.stdout).toContain("1 vulnerability (1 high)");
      expect(prod.exitCode).toBe(1);
    },
  );
});

describe("`bun audit --omit`", () => {
  test.concurrent.each(["dev", "optional", "peer"] as const)(
    "--omit=%s skips packages only reached that way",
    async kind => {
      await using server = startRegistry({ "no-deps": [adv("<1.0.1")] });
      const field = { dev: "devDependencies", optional: "optionalDependencies", peer: "peerDependencies" }[kind];
      using dir = await setup(server, { name: "foo", [field]: { "no-deps": "1.0.0" } });
      expect(await lock(dir)).toContain('"no-deps@1.0.0"');

      const all = await audit(dir);
      expect(all.stdout).toContain("1 vulnerability (1 high)");
      expect(all.exitCode).toBe(1);

      const omitted = await audit(dir, `--omit=${kind}`);
      expect(omitted.stdout).toBe("No vulnerabilities found\n");
      expect(omitted.exitCode).toBe(0);
    },
  );

  test.concurrent("--omit=optional keeps auditing dev dependencies", async () => {
    await using server = startRegistry({ "no-deps": [adv("<1.0.1")] });
    using dir = await setup(server, { name: "foo", devDependencies: { "no-deps": "1.0.0" } });

    const { stdout, exitCode } = await audit(dir, "--omit=optional");
    expect(stdout).toContain("1 vulnerability (1 high)");
    expect(exitCode).toBe(1);
  });
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
    const rootBefore = await pkgJsonText(dir);
    const dependentBefore = await pkgJsonText(dir, "node_modules", "one-dep");

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "blocked by a dependent's range:
        no-deps@1.0.1 → 1.1.0
          one-dep@1.0.0 depends on no-deps@1.0.1

      No fixable vulnerabilities
      1 vulnerability remaining"
    `);
    expect(stderr).not.toContain("Saved lockfile");
    expect(exitCode).toBe(1);
    expect(await lock(dir)).toBe(lockBefore);
    expect(await pkgJsonText(dir)).toBe(rootBefore);
    expect(await pkgJsonText(dir, "node_modules", "one-dep")).toBe(dependentBefore);
  });

  test.concurrent("a safe older release outside the dependent's range is not a downgrade candidate", async () => {
    await using server = startRegistry({ "no-deps": [adv(">=1.0.1 <2.0.0")] });
    using dir = await setup(server, { name: "foo", dependencies: { "one-dep": "1.0.0" } });
    const lockBefore = await lock(dir);
    expect(lockBefore).toContain('"no-deps@1.0.1"');

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "blocked by a dependent's range:
        no-deps@1.0.1 → 2.0.0
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

  test.concurrent("a range that rejects every safe release is blocked on the highest safe downgrade", async () => {
    await using server = startRegistry({ "no-deps": [adv(">=2.0.0")] });
    using dir = await setup(server, { name: "foo", dependencies: { "no-deps": "^2.0.0" } });
    const lockBefore = await lock(dir);
    expect(lockBefore).toContain('"no-deps@2.0.0"');

    const { stdout, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "blocked by a dependent's range:
        no-deps@2.0.0 → 1.1.0 (downgrade)
          foo depends on no-deps@^2.0.0

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
    expect(stdout).toContain("blocked by a dependent's range:");
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
    expect(recheck.stdout).toContain("1 vulnerability (1 high)");
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
    const rootBefore = await pkgJsonText(dir);
    const memberBefore = await pkgJsonText(dir, "packages", "a");

    const { stdout, exitCode } = await auditFix(dir);
    expect(stdout).toContain("no-deps@1.0.0 → 1.0.1");
    expect(stdout).not.toContain("package.json");
    expect(exitCode).toBe(0);

    lockfile = await lock(dir);
    expect(lockfile).toContain('"no-deps@1.0.1"');
    expect(lockfile).not.toContain('"no-deps@1.0.0"');
    expect(await pkgJsonText(dir)).toBe(rootBefore);
    expect(await pkgJsonText(dir, "packages", "a")).toBe(memberBefore);
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

  test.concurrent("rejects extra arguments", async () => {
    await using server = startRegistry({});
    using dir = await setup(server, { name: "foo", dependencies: { "no-deps": "1.0.0" } });
    const lockBefore = await lock(dir);

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

  test.concurrent("an advisory for an installed prerelease is matched and the pin is rewritten", async () => {
    await using server = startRegistry({}, { bulkResponse: { "no-deps-backward-tags": [adv("<1.1.0")] } });
    using dir = await setup(server, { name: "foo", dependencies: { "no-deps-backward-tags": "1.0.0-rc.1" } });
    expect(await lock(dir)).toContain('"no-deps-backward-tags@1.0.0-rc.1"');

    const { stdout, exitCode } = await auditFix(dir);
    expect(stdout).toContain("no-deps-backward-tags@1.0.0-rc.1 → 1.1.0");
    expect(stdout).toContain("package.json: 1.0.0-rc.1 → 1.1.0");
    expect(stdout).toContain("Fixed 1 vulnerability in 1 package");
    expect(exitCode).toBe(0);

    expect((await pkgJson(dir)).dependencies["no-deps-backward-tags"]).toBe("1.1.0");
    const lockfile = await lock(dir);
    expect(lockfile).toContain('"no-deps-backward-tags@1.1.0"');
    expect(lockfile).not.toContain("1.0.0-rc.1");

    await runBunInstall(installEnv(dir), dir, { frozenLockfile: true });
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
      "blocked by a dependent's range:
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

  // npm-style advisory objects carry extra fields (findings, patched_versions, ...) that must be ignored.
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

  test.concurrent("parses a large bulk response and only plans installed packages", async () => {
    const bulkResponse = await file(
      join(import.meta.dirname, "registry", "fixtures", "audit", "pnpm-all-vulnerabilities-response.json"),
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

  test.concurrent("a version held by an overrides entry is blocked and the override is not rewritten", async () => {
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")] });
    using dir = await setup(server, {
      name: "foo",
      dependencies: { "a-dep": "^1.0.2" },
      overrides: { "a-dep": "1.0.2" },
    });
    const lockBefore = await lock(dir);
    expect(lockBefore).toContain('"a-dep@1.0.2"');
    const pkgJsonBefore = await pkgJsonText(dir);

    const { stdout, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "blocked by a dependent's range:
        a-dep@1.0.2 → 1.0.4
          foo depends on a-dep@1.0.2

      No fixable vulnerabilities
      1 vulnerability remaining"
    `);
    expect(exitCode).toBe(1);
    expect(await lock(dir)).toBe(lockBefore);
    expect(await pkgJsonText(dir)).toBe(pkgJsonBefore);
  });

  test.concurrent("a pinned catalog entry is rewritten and the member keeps `catalog:`", async () => {
    await using server = startRegistry({ "no-deps": [adv("<1.0.1")] });
    const member = JSON.stringify({ name: "a", dependencies: { "no-deps": "catalog:" } });
    using dir = await setup(
      server,
      { name: "root", workspaces: ["packages/*"], catalog: { "no-deps": "1.0.0" } },
      { "packages/a/package.json": member },
    );
    expect(await lock(dir)).toContain('"no-deps@1.0.0"');

    const { stdout, exitCode } = await auditFix(dir);
    expect(stdout).toContain("no-deps@1.0.0 → 1.0.1");
    expect(stdout).toContain("package.json (catalog): 1.0.0 → 1.0.1");
    expect(stdout).toContain("Fixed 1 vulnerability in 1 package");
    expect(exitCode).toBe(0);

    expect((await pkgJson(dir)).catalog).toEqual({ "no-deps": "1.0.1" });
    expect(await pkgJsonText(dir, "packages", "a")).toBe(member);
    const lockfile = await lock(dir);
    expect(lockfile).toContain('"no-deps@1.0.1"');
    expect(lockfile).not.toContain('"no-deps@1.0.0"');
    expect(lockfile).toContain('"no-deps": "1.0.1"');
    expect(lockfile).toContain('"no-deps": "catalog:"');

    await runBunInstall(installEnv(dir), dir, { frozenLockfile: true });
  });

  test.concurrent("rewrites a named catalog entry and leaves unused catalogs alone", async () => {
    await using server = startRegistry({ "no-deps": [adv("<1.0.1")] });
    const member = JSON.stringify({ name: "a", dependencies: { "no-deps": "catalog:build" } });
    using dir = await setup(
      server,
      {
        name: "root",
        workspaces: ["packages/*"],
        catalogs: { build: { "no-deps": "1.0.0" }, other: { "no-deps": "1.0.0" } },
      },
      { "packages/a/package.json": member },
    );
    expect(await lock(dir)).toContain('"no-deps@1.0.0"');

    const { stdout, exitCode } = await auditFix(dir);
    expect(stdout).toContain("no-deps@1.0.0 → 1.0.1");
    expect(stdout).toContain("package.json (catalog build): 1.0.0 → 1.0.1");
    expect(exitCode).toBe(0);

    expect((await pkgJson(dir)).catalogs).toEqual({ build: { "no-deps": "1.0.1" }, other: { "no-deps": "1.0.0" } });
    expect(await pkgJsonText(dir, "packages", "a")).toBe(member);
    const lockfile = await lock(dir);
    expect(lockfile).toContain('"no-deps@1.0.1"');
    expect(lockfile).not.toContain('"no-deps@1.0.0"');

    await runBunInstall(installEnv(dir), dir, { frozenLockfile: true });
  });

  // mismatched-peer-deps-lvl1's own dependency declares a peer the install warns about, so runBunInstall cannot be used.
  test.concurrent("a peer edge that rejects the fix is split off and labelled with the peer dependent", async () => {
    await using server = startRegistry({ "no-deps": [adv("<=1.0.1")] });
    const rootPkgJson = (noDeps: string) =>
      JSON.stringify({ name: "foo", dependencies: { "mismatched-peer-deps-lvl1": "1.0.0", "no-deps": noDeps } });
    using dir = tempDir("audit-fix-", { "package.json": rootPkgJson("1.0.1") });
    await writeBunfig(dir, server);
    await expectInstall(dir);
    await write(join(dir, "package.json"), rootPkgJson("^1.0.0"));
    await expectInstall(dir);
    expect(await lock(dir)).toContain('"no-deps@1.0.1"');

    const { stdout, exitCode } = await auditFix(dir);
    expect(stdout).toContain("fixing:\n  no-deps@1.0.1 → 1.1.0");
    expect(stdout).toContain("blocked by a dependent's range:");
    expect(stdout).toContain("mismatched-peer-deps-lvl1@1.0.0 depends on no-deps@<=1.0.1");
    expect(stdout).not.toContain("foo depends on");
    expect(stdout).toContain("1 vulnerability remaining");
    expect(exitCode).toBe(1);
    expect(await lock(dir)).toContain('"no-deps@1.1.0"');
  });

  test.concurrent("a depth-3 blocker names the immediate dependent", async () => {
    await using server = startRegistry({ "no-deps": [adv("<1.1.0")] });
    using dir = await setup(server, { name: "foo", dependencies: { "one-one-dep": "1.0.0" } });
    const lockBefore = await lock(dir);
    expect(lockBefore).toContain('"no-deps@1.0.1"');

    const { stdout, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "blocked by a dependent's range:
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
    await expectInstall(dir, "--linker", "hoisted");
    await write(join(dir, "packages", "a", "package.json"), member("^1.0.2"));
    await expectInstall(dir, "--linker", "hoisted");
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

  test.concurrent("isolated linker layout", async () => {
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")] });
    using dir = tempDir("audit-fix-", {
      "package.json": JSON.stringify({ name: "foo", dependencies: { "a-dep": "1.0.2" } }),
    });
    await writeBunfig(dir, server);
    await expectInstall(dir, "--linker", "isolated");
    await write(join(dir, "package.json"), JSON.stringify({ name: "foo", dependencies: { "a-dep": "^1.0.2" } }));
    await expectInstall(dir, "--linker", "isolated");
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
  test.concurrent("a fix newer than --minimum-release-age is installed anyway", async () => {
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")] });
    using dir = await setupVulnerableADep(server);
    const lockBefore = await lock(dir);

    const dryRun = await auditFix(dir, "--dry-run", "--minimum-release-age", "3153600000");
    expect(dryRun.stdout).toContain("a-dep@1.0.2 → 1.0.4 (newer than --minimum-release-age)");
    expect(dryRun.stdout).toContain("Would fix 1 vulnerability in 1 package");
    expect(dryRun.exitCode).toBe(0);
    expect(await lock(dir)).toBe(lockBefore);

    const { stdout, stderr, exitCode } = await auditFix(dir, "--minimum-release-age", "3153600000");
    expect(stdout).toContain("a-dep@1.0.2 → 1.0.4 (newer than --minimum-release-age)");
    expect(stdout).toContain("Fixed 1 vulnerability in 1 package");
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
    expect(await lock(dir)).toContain('"a-dep@1.0.4"');
    expect(await installedVersion(dir, "a-dep")).toBe("1.0.4");

    await expectInstall(dir, "--frozen-lockfile", "--minimum-release-age", "3153600000");
  });

  test.concurrent(
    "the lowest safe release is taken even when only it is newer than --minimum-release-age",
    async () => {
      await using server = startRegistry(
        { "a-dep": [adv("<1.0.4")] },
        { rewriteTime: { "a-dep": { "1.0.4": new Date().toISOString() } } },
      );
      using dir = await setupVulnerableADep(server);

      const { stdout, exitCode } = await auditFix(dir, "--minimum-release-age", "86400");
      expect(stdout).toContain("a-dep@1.0.2 → 1.0.4 (newer than --minimum-release-age)");
      expect(stdout).not.toContain("1.0.5");
      expect(exitCode).toBe(0);
      const lockfile = await lock(dir);
      expect(lockfile).toContain('"a-dep@1.0.4"');
      expect(lockfile).not.toContain('"a-dep@1.0.5"');
    },
  );

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
      "manifest could not be fetched:
        a-dep@1.0.2

      No fixable vulnerabilities
      1 vulnerability remaining"
    `);
    expect(stderr).toContain("a-dep");
    expect(stderr).not.toContain("Saved lockfile");
    expect(exitCode).toBe(1);
    expect(await lock(dir)).toBe(lockBefore);
  });

  test.concurrent("a manifest that fails to download does not stop the other fixes", async () => {
    const denyManifests = new Set<string>();
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")], "no-deps": [adv("<1.0.1", 2)] }, { denyManifests });
    using dir = await setup(server, { name: "foo", dependencies: { "a-dep": "1.0.2", "no-deps": "1.0.0" } });
    await reinstall(dir, { name: "foo", dependencies: { "a-dep": "^1.0.2", "no-deps": "^1.0.0" } });
    denyManifests.add("a-dep");

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(stdout).toContain("fixing:\n  no-deps@1.0.0 → 1.0.1\n");
    expect(stdout).toContain("manifest could not be fetched:\n  a-dep@1.0.2\n");
    expect(stdout).not.toContain("no fix available:");
    expect(stdout).toContain("Fixed 1 vulnerability in 1 package");
    expect(stdout).toContain("1 vulnerability remaining");
    expect(stderr).toContain("a-dep");
    expect(exitCode).toBe(1);

    const lockfile = await lock(dir);
    expect(lockfile).toContain('"no-deps@1.0.1"');
    expect(lockfile).toContain('"a-dep@1.0.2"');
  });

  test.concurrent("a fix whose tarball fails to download is not reported as fixed", async () => {
    const denyTarballs = new Set<string>();
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")] }, { denyTarballs });
    using dir = await setupVulnerableADep(server);
    denyTarballs.add("a-dep-1.0.4.tgz");

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(stdout).toContain("a-dep@1.0.2 → 1.0.4");
    expect(stdout).not.toContain("Fixed 1 vulnerability");
    expect(stderr).toContain("a-dep");
    expect(stderr).toContain("1.0.4");
    expect(exitCode).toBe(1);
    expect(await installedVersion(dir, "a-dep")).toBe("1.0.2");
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

  test.concurrent("rewrites an exact direct pin", async () => {
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")] });
    const before = [
      "{",
      '    "name": "foo",',
      '    "scripts": {',
      '        "check": "true"',
      "    },",
      '    "dependencies": {',
      '        "a-dep": "1.0.2"',
      "    }",
      "}",
      "",
    ].join("\n");
    using dir = await setup(server, before);
    expect(await lock(dir)).toContain('"a-dep@1.0.2"');

    const { stdout, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toStartWith("fixing:\n  a-dep@1.0.2 → 1.0.4\n    package.json: 1.0.2 → 1.0.4");
    expect(stdout).toContain("Fixed 1 vulnerability in 1 package");
    expect(exitCode).toBe(0);

    expect(await pkgJsonText(dir)).toBe(before.replace('"a-dep": "1.0.2"', '"a-dep": "1.0.4"'));
    const lockfile = await lock(dir);
    expect(lockfile).toContain('"a-dep": "1.0.4"');
    expect(lockfile).toContain('"a-dep@1.0.4"');
    expect(lockfile).not.toContain("a-dep@1.0.2");
    expect(await installedVersion(dir, "a-dep")).toBe("1.0.4");

    const recheck = await audit(dir);
    expect(recheck.stdout).toBe("No vulnerabilities found\n");
    expect(recheck.exitCode).toBe(0);

    await runBunInstall(installEnv(dir), dir, { frozenLockfile: true });
  });

  test.concurrent("--dry-run does not rewrite a pin", async () => {
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")] });
    using dir = await setup(server, { name: "foo", dependencies: { "a-dep": "1.0.2" } });
    const pkgJsonBefore = await pkgJsonText(dir);
    const lockBefore = await lock(dir);

    const { stdout, exitCode } = await auditFix(dir, "--dry-run");
    expect(stdout).toContain("a-dep@1.0.2 → 1.0.4");
    expect(stdout).toContain("package.json: 1.0.2 → 1.0.4");
    expect(stdout).toContain("Would fix 1 vulnerability in 1 package");
    expect(exitCode).toBe(0);
    expect(await pkgJsonText(dir)).toBe(pkgJsonBefore);
    expect(await lock(dir)).toBe(lockBefore);
    expect(await installedVersion(dir, "a-dep")).toBe("1.0.2");
  });

  test.concurrent("a pin is only widened within its major", async () => {
    await using server = startRegistry({ "no-deps": [adv("<2.0.0")] });
    using dir = await setup(server, { name: "foo", dependencies: { "no-deps": "1.0.0" } });
    const pkgJsonBefore = await pkgJsonText(dir);
    const lockBefore = await lock(dir);

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "blocked by a dependent's range:
        no-deps@1.0.0 → 2.0.0
          foo depends on no-deps@1.0.0

      No fixable vulnerabilities
      1 vulnerability remaining"
    `);
    expect(stderr).not.toContain("Saved lockfile");
    expect(exitCode).toBe(1);
    expect(await pkgJsonText(dir)).toBe(pkgJsonBefore);
    expect(await lock(dir)).toBe(lockBefore);
  });

  test.concurrent("rewrites an exact npm: alias pin", async () => {
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")] });
    using dir = await setup(server, { name: "foo", dependencies: { nd: "npm:a-dep@1.0.2" } });
    expect(await lock(dir)).toContain('"a-dep@1.0.2"');

    const { stdout, exitCode } = await auditFix(dir);
    expect(stdout).toContain("a-dep@1.0.2 → 1.0.4");
    expect(stdout).toContain("package.json: npm:a-dep@1.0.2 → npm:a-dep@1.0.4");
    expect(exitCode).toBe(0);

    expect((await pkgJson(dir)).dependencies).toEqual({ nd: "npm:a-dep@1.0.4" });
    expect(await installedVersion(dir, "nd")).toBe("1.0.4");

    await runBunInstall(installEnv(dir), dir, { frozenLockfile: true });
  });

  test.concurrent("rewrites a pinned devDependency in its own group only", async () => {
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")], "no-deps": [adv("<1.0.1", 2)] });
    using dir = await setup(server, {
      name: "foo",
      dependencies: { "no-deps": "1.0.0" },
      devDependencies: { "a-dep": "1.0.2" },
    });
    await reinstall(dir, { name: "foo", dependencies: { "no-deps": "^1.0.0" }, devDependencies: { "a-dep": "1.0.2" } });
    let lockfile = await lock(dir);
    expect(lockfile).toContain('"a-dep@1.0.2"');
    expect(lockfile).toContain('"no-deps@1.0.0"');

    const { stdout, exitCode } = await auditFix(dir);
    expect(stdout).toContain("a-dep@1.0.2 → 1.0.4\n    package.json: 1.0.2 → 1.0.4\n");
    expect(stdout).toContain("no-deps@1.0.0 → 1.0.1\n");
    expect(stdout).toContain("Fixed 2 vulnerabilities in 2 packages");
    expect(exitCode).toBe(0);

    const { dependencies, devDependencies } = await pkgJson(dir);
    expect({ dependencies, devDependencies }).toEqual({
      dependencies: { "no-deps": "^1.0.0" },
      devDependencies: { "a-dep": "1.0.4" },
    });
    lockfile = await lock(dir);
    expect(lockfile).toContain('"a-dep@1.0.4"');
    expect(lockfile).toContain('"no-deps@1.0.1"');

    await runBunInstall(installEnv(dir), dir, { frozenLockfile: true });
  });

  test.concurrent("rewrites a workspace member's pin and leaves the root alone", async () => {
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")] });
    const rootPkgJson = JSON.stringify({ name: "root", workspaces: ["packages/*"] });
    using dir = await setup(server, rootPkgJson, {
      "packages/a/package.json": JSON.stringify({ name: "a", dependencies: { "a-dep": "1.0.2" } }),
    });
    expect(await lock(dir)).toContain('"a-dep@1.0.2"');

    const { stdout, exitCode } = await auditFix(dir);
    expect(stdout).toContain("a-dep@1.0.2 → 1.0.4\n    packages/a/package.json: 1.0.2 → 1.0.4\n");
    expect(exitCode).toBe(0);

    expect((await pkgJson(dir, "packages", "a")).dependencies).toEqual({ "a-dep": "1.0.4" });
    expect(await pkgJsonText(dir)).toBe(rootPkgJson);
    const lockfile = await lock(dir);
    expect(lockfile).toContain('"a-dep@1.0.4"');
    expect(lockfile).toContain('"a-dep": "1.0.4"');
    expect(lockfile).not.toContain("a-dep@1.0.2");
    expect(await exists(join(dir, "packages", "a", "bun.lock"))).toBeFalse();

    await runBunInstall(installEnv(dir), dir, { frozenLockfile: true });
  });

  test.concurrent("rewrites a workspace member's pin when run from the member directory", async () => {
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")] });
    const rootPkgJson = JSON.stringify({ name: "root", workspaces: ["packages/*"] });
    using dir = tempDir("audit-fix-", {
      "package.json": rootPkgJson,
      "packages/a/package.json": JSON.stringify({ name: "a", dependencies: { "a-dep": "1.0.2" } }),
    });
    await writeBunfig(dir, server);
    await expectInstall(dir, "--linker", "hoisted");
    expect(await lock(dir)).toContain('"a-dep@1.0.2"');

    const { stdout, exitCode } = await run(join(dir, "packages", "a"), ["audit", "fix", "--linker", "hoisted"], dir);
    expect(stdout).toContain("a-dep@1.0.2 → 1.0.4\n    packages/a/package.json: 1.0.2 → 1.0.4\n");
    expect(exitCode).toBe(0);

    expect((await pkgJson(dir, "packages", "a")).dependencies).toEqual({ "a-dep": "1.0.4" });
    expect(await pkgJsonText(dir)).toBe(rootPkgJson);
    expect(await exists(join(dir, "packages", "a", "bun.lock"))).toBeFalse();
    expect(await lock(dir)).toContain('"a-dep@1.0.4"');
    expect(await installedVersion(dir, "a-dep")).toBe("1.0.4");

    await expectInstall(dir, "--frozen-lockfile", "--linker", "hoisted");
  });

  test.concurrent("splits an instance when only some dependents accept the fix", async () => {
    await using server = startRegistry({ "no-deps": [adv("<1.0.1")] });
    using dir = await setup(server, { name: "foo", dependencies: { "one-fixed-dep": "1.0.0", "no-deps": "1.0.0" } });
    await reinstall(dir, { name: "foo", dependencies: { "one-fixed-dep": "1.0.0", "no-deps": "^1.0.0" } });
    let lockfile = await lock(dir);
    expect(lockfile).toContain('"no-deps@1.0.0"');
    expect(lockfile).not.toContain('"no-deps@1.0.1"');

    const { stdout, exitCode } = await auditFix(dir);
    expect(stdout).toContain("fixing:\n  no-deps@1.0.0 → 1.0.1\n");
    expect(stdout).toContain("blocked by a dependent's range:");
    expect(stdout).toContain("one-fixed-dep@1.0.0 depends on no-deps@1.0.0");
    expect(stdout).toContain("Fixed 0 vulnerabilities in 1 package");
    expect(stdout).toContain("1 vulnerability remaining");
    expect(exitCode).toBe(1);

    lockfile = await lock(dir);
    expect(lockfile).toContain('"no-deps@1.0.1"');
    expect(lockfile).toContain('"no-deps@1.0.0"');
    expect(await installedVersion(dir, "no-deps")).toBe("1.0.1");
    expect(await installedVersion(dir, "one-fixed-dep", "node_modules", "no-deps")).toBe("1.0.0");

    await runBunInstall(installEnv(dir), dir, { frozenLockfile: true });
  });

  test.concurrent("splits an instance shared by two transitive dependents", async () => {
    await using server = startRegistry({ "no-deps": [adv("<1.0.1")] });
    using dir = await setup(server, {
      name: "foo",
      dependencies: { "one-range-dep": "1.0.0", "one-fixed-dep": "1.0.0", "no-deps": "1.0.0" },
    });
    await reinstall(dir, { name: "foo", dependencies: { "one-range-dep": "1.0.0", "one-fixed-dep": "1.0.0" } });
    const lockBefore = await lock(dir);
    expect(lockBefore).toContain('"no-deps@1.0.0"');
    expect(lockBefore).not.toContain('"no-deps@1.0.1"');

    const dryRun = await auditFix(dir, "--dry-run");
    expect(dryRun.stdout).toContain("fixing:\n  no-deps@1.0.0 → 1.0.1\n");
    expect(dryRun.stdout).toContain("one-fixed-dep@1.0.0 depends on no-deps@1.0.0");
    expect(dryRun.stdout).not.toContain("one-range-dep@1.0.0 depends on");
    expect(dryRun.exitCode).toBe(1);
    expect(await lock(dir)).toBe(lockBefore);

    const { exitCode } = await auditFix(dir);
    expect(exitCode).toBe(1);
    const lockfile = await lock(dir);
    expect(lockfile).toContain('"no-deps@1.0.1"');
    expect(lockfile).toContain('"no-deps@1.0.0"');
    expect(await resolvedVersion(dir, "one-range-dep", "no-deps")).toBe("1.0.1");
    expect(await resolvedVersion(dir, "one-fixed-dep", "no-deps")).toBe("1.0.0");

    await runBunInstall(installEnv(dir), dir, { frozenLockfile: true });
  });

  test.concurrent("a split instance under the isolated linker keeps both versions in the store", async () => {
    await using server = startRegistry({ "no-deps": [adv("<1.0.1")] });
    const rootPkgJson = (deps: Record<string, string>) => JSON.stringify({ name: "foo", dependencies: deps });
    using dir = tempDir("audit-fix-", {
      "package.json": rootPkgJson({ "one-range-dep": "1.0.0", "one-fixed-dep": "1.0.0", "no-deps": "1.0.0" }),
    });
    await writeBunfig(dir, server);
    await expectInstall(dir, "--linker", "isolated");
    await write(join(dir, "package.json"), rootPkgJson({ "one-range-dep": "1.0.0", "one-fixed-dep": "1.0.0" }));
    await expectInstall(dir, "--linker", "isolated");
    const lockBefore = await lock(dir);
    expect(lockBefore).toContain('"no-deps@1.0.0"');
    expect(lockBefore).not.toContain('"no-deps@1.0.1"');

    const { stdout, exitCode } = await auditFix(dir, "--linker", "isolated");
    expect(stdout).toContain("fixing:\n  no-deps@1.0.0 → 1.0.1\n");
    expect(exitCode).toBe(1);

    const lockfile = await lock(dir);
    expect(lockfile).toContain('"no-deps@1.0.1"');
    expect(lockfile).toContain('"no-deps@1.0.0"');
    expect(await installedVersion(dir, ".bun", "one-range-dep@1.0.0", "node_modules", "no-deps")).toBe("1.0.1");
    expect(await installedVersion(dir, ".bun", "one-fixed-dep@1.0.0", "node_modules", "no-deps")).toBe("1.0.0");

    await expectInstall(dir, "--frozen-lockfile", "--linker", "isolated");
  });

  test.concurrent(
    "a rewritten root pin moves even though a transitive dependent still pins the old version",
    async () => {
      await using server = startRegistry({ "a-dep": [adv("<1.0.4")] });
      using dir = await setup(server, { name: "foo", dependencies: { "a-dep": "1.0.2", "uses-a-dep-2": "1.0.0" } });
      let lockfile = await lock(dir);
      expect(lockfile).toContain('"a-dep@1.0.2"');
      expect(lockfile).not.toContain('"a-dep@1.0.4"');

      const { stdout, exitCode } = await auditFix(dir);
      expect(stdout).toContain("fixing:\n  a-dep@1.0.2 → 1.0.4\n    package.json: 1.0.2 → 1.0.4\n");
      expect(stdout).toContain("uses-a-dep-2@1.0.0 depends on a-dep@1.0.2");
      expect(stdout).toContain("1 vulnerability remaining");
      expect(exitCode).toBe(1);

      expect((await pkgJson(dir)).dependencies).toEqual({ "a-dep": "1.0.4", "uses-a-dep-2": "1.0.0" });
      lockfile = await lock(dir);
      expect(lockfile).toContain('"a-dep@1.0.4"');
      expect(lockfile).toContain('"a-dep@1.0.2"');
      expect(await installedVersion(dir, "a-dep")).toBe("1.0.4");
      expect(await installedVersion(dir, "uses-a-dep-2", "node_modules", "a-dep")).toBe("1.0.2");

      await runBunInstall(installEnv(dir), dir, { frozenLockfile: true });
    },
  );

  test.concurrent("downgrades when no newer release is safe", async () => {
    await using server = startRegistry({ "a-dep": [adv(">=1.0.3")] });
    using dir = await setup(server, { name: "foo", dependencies: { "a-dep": "^1.0.0" } });
    const lockBefore = await lock(dir);
    expect(lockBefore).toContain('"a-dep@1.0.10"');
    const pkgJsonBefore = await pkgJsonText(dir);

    const dryRun = await auditFix(dir, "--dry-run");
    expect(normalizeBunSnapshot(dryRun.stdout)).toMatchInlineSnapshot(`
      "fixing:
        a-dep@1.0.10 → 1.0.2 (downgrade)

      Would fix 1 vulnerability in 1 package"
    `);
    expect(dryRun.exitCode).toBe(0);
    expect(await lock(dir)).toBe(lockBefore);

    const { stdout, exitCode } = await auditFix(dir);
    expect(stdout).toContain("a-dep@1.0.10 → 1.0.2 (downgrade)");
    expect(stdout).toContain("Fixed 1 vulnerability in 1 package");
    expect(exitCode).toBe(0);

    const lockfile = await lock(dir);
    expect(lockfile).toContain('"a-dep@1.0.2"');
    expect(lockfile).not.toContain('"a-dep@1.0.10"');
    expect(await installedVersion(dir, "a-dep")).toBe("1.0.2");
    expect(await pkgJsonText(dir)).toBe(pkgJsonBefore);

    const recheck = await audit(dir);
    expect(recheck.stdout).toBe("No vulnerabilities found\n");
    expect(recheck.exitCode).toBe(0);
  });

  test.concurrent("downgrades a transitive dependency within its dependent's range", async () => {
    await using server = startRegistry({ "no-deps": [adv(">=1.0.1 <2.0.0")] });
    using dir = await setup(server, { name: "foo", dependencies: { "one-range-dep": "1.0.0" } });
    expect(await lock(dir)).toContain('"no-deps@1.1.0"');

    const { stdout, exitCode } = await auditFix(dir);
    expect(stdout).toContain("no-deps@1.1.0 → 1.0.0 (downgrade)");
    expect(stdout).not.toContain("depends on");
    expect(stdout).toContain("Fixed 1 vulnerability in 1 package");
    expect(exitCode).toBe(0);

    const lockfile = await lock(dir);
    expect(lockfile).toContain('"no-deps@1.0.0"');
    expect(lockfile).not.toContain('"no-deps@1.1.0"');
    expect(lockfile).not.toContain('"no-deps@2.0.0"');
    expect(await installedVersion(dir, "no-deps")).toBe("1.0.0");

    await runBunInstall(installEnv(dir), dir, { frozenLockfile: true });
  });

  test.concurrent("prefers the lowest safe upgrade over any downgrade", async () => {
    await using server = startRegistry({ "a-dep": [adv(">=1.0.2 <1.0.4")] });
    using dir = await setup(server, { name: "foo", dependencies: { "a-dep": "1.0.2" } });
    await reinstall(dir, { name: "foo", dependencies: { "a-dep": "^1.0.1" } });
    expect(await lock(dir)).toContain('"a-dep@1.0.2"');

    const { stdout, exitCode } = await auditFix(dir);
    expect(stdout).toContain("a-dep@1.0.2 → 1.0.4");
    expect(stdout).not.toContain("downgrade");
    expect(exitCode).toBe(0);

    const lockfile = await lock(dir);
    expect(lockfile).toContain('"a-dep@1.0.4"');
    expect(lockfile).not.toContain('"a-dep@1.0.1"');
    expect(lockfile).not.toContain('"a-dep@1.0.5"');
  });

  test.concurrent("counts a vulnerability removed by another fix from the written lockfile", async () => {
    await using server = startRegistry({ "one-fixed-dep": [adv("<2.0.0")], "no-deps": [adv("<1.0.1", 2)] });
    using dir = await setup(server, { name: "foo", dependencies: { "one-fixed-dep": "1.0.0" } });
    await reinstall(dir, { name: "foo", dependencies: { "one-fixed-dep": ">=1.0.0" } });
    let lockfile = await lock(dir);
    expect(lockfile).toContain('"one-fixed-dep@1.0.0"');
    expect(lockfile).toContain('"no-deps@1.0.0"');

    const { stdout, exitCode } = await auditFix(dir);
    expect(stdout).toContain("one-fixed-dep@1.0.0 → 2.0.0");
    expect(stdout).toContain("one-fixed-dep@1.0.0 depends on no-deps@1.0.0");
    expect(stdout).toContain("Fixed 2 vulnerabilities in 1 package");
    expect(stdout).not.toContain("remaining");
    expect(exitCode).toBe(0);

    lockfile = await lock(dir);
    expect(lockfile).toContain('"one-fixed-dep@2.0.0"');
    expect(lockfile).toContain('"no-deps@2.0.0"');
    expect(lockfile).not.toContain('"no-deps@1.0.0"');

    const recheck = await audit(dir);
    expect(recheck.stdout).toBe("No vulnerabilities found\n");
    expect(recheck.exitCode).toBe(0);
  });

  test.concurrent("reports vulnerable versions introduced by the fix from the written lockfile", async () => {
    await using server = startRegistry(
      {},
      { bulkResponse: { "one-fixed-dep": [adv("<2.0.0")], "no-deps": [adv(">=2.0.0", 2)] } },
    );
    using dir = await setup(server, { name: "foo", dependencies: { "one-fixed-dep": "1.0.0" } });
    await reinstall(dir, { name: "foo", dependencies: { "one-fixed-dep": "^1.0.0 || ^2.0.0" } });
    expect(await lock(dir)).toContain('"one-fixed-dep@1.0.0"');

    const { stdout, exitCode } = await auditFix(dir);
    expect(stdout).toContain("one-fixed-dep@1.0.0 → 2.0.0");
    expect(stdout).toContain("vulnerable after install:\n  no-deps@2.0.0\n");
    expect(stdout).toContain("Fixed 1 vulnerability in 1 package");
    expect(stdout).toContain("1 vulnerability remaining");
    expect(exitCode).toBe(1);
    expect(await lock(dir)).toContain('"no-deps@2.0.0"');
  });

  test.concurrent("--json prints a plan document with --dry-run", async () => {
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")] });
    using dir = await setup(server, { name: "foo", dependencies: { "a-dep": "1.0.2" } });
    const pkgJsonBefore = await pkgJsonText(dir);
    const lockBefore = await lock(dir);

    const { stdout, exitCode } = await auditFix(dir, "--json", "--dry-run");
    expect(JSON.parse(stdout)).toEqual({
      dryRun: true,
      fixed: 1,
      remaining: 0,
      fixes: [
        {
          name: "a-dep",
          from: "1.0.2",
          to: "1.0.4",
          downgrade: false,
          newerThanMinimumReleaseAge: false,
          packageJson: [{ file: "package.json", key: "a-dep", from: "1.0.2", to: "1.0.4" }],
        },
      ],
      blocked: [],
      unfixable: [],
      manifestUnavailable: [],
      unmatched: [],
      unaudited: [],
      vulnerableAfterInstall: [],
    });
    expect(exitCode).toBe(0);
    expect(await pkgJsonText(dir)).toBe(pkgJsonBefore);
    expect(await lock(dir)).toBe(lockBefore);
  });

  test.concurrent("--json prints the result after installing", async () => {
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")] });
    using dir = await setupVulnerableADep(server);

    const { stdout, exitCode } = await auditFix(dir, "--json");
    expect(stdout.trim().split("\n")).toHaveLength(1);
    const doc = JSON.parse(stdout);
    expect(doc).toMatchObject({ dryRun: false, fixed: 1, remaining: 0 });
    expect(doc.fixes).toEqual([
      {
        name: "a-dep",
        from: "1.0.2",
        to: "1.0.4",
        downgrade: false,
        newerThanMinimumReleaseAge: false,
        packageJson: [],
      },
    ]);
    expect(exitCode).toBe(0);
    expect(await lock(dir)).toContain('"a-dep@1.0.4"');

    const clean = await auditFix(dir, "--json");
    expect(JSON.parse(clean.stdout)).toMatchObject({ dryRun: false, fixed: 0, remaining: 0, fixes: [] });
    expect(clean.exitCode).toBe(0);
  });

  test.concurrent("--json with a blocked and an unmatched advisory", async () => {
    await using server = startRegistry({}, { bulkResponse: { "no-deps": [adv("<1.1.0"), adv(">=9.0.0", 2)] } });
    using dir = await setup(server, { name: "foo", dependencies: { "one-dep": "1.0.0" } });
    const lockBefore = await lock(dir);
    expect(lockBefore).toContain('"no-deps@1.0.1"');

    const { stdout, exitCode } = await auditFix(dir, "--json");
    const doc = JSON.parse(stdout);
    expect(doc.blocked).toEqual([
      {
        name: "no-deps",
        from: "1.0.1",
        needs: "1.1.0",
        downgrade: false,
        blockers: [{ dependent: "one-dep@1.0.0", range: "1.0.1", bundled: false }],
      },
    ]);
    expect(doc.unmatched).toEqual([{ name: "no-deps", range: ">=9.0.0" }]);
    expect(doc).toMatchObject({ dryRun: false, fixed: 0, remaining: 2, fixes: [] });
    expect(exitCode).toBe(1);
    expect(await lock(dir)).toBe(lockBefore);
  });

  test.concurrent("--json after installing carries the fixed and the blocked entries", async () => {
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")], "no-deps": [adv("<1.1.0", 2)] });
    using dir = await setup(server, { name: "foo", dependencies: { "a-dep": "1.0.2", "one-dep": "1.0.0" } });
    await reinstall(dir, { name: "foo", dependencies: { "a-dep": "^1.0.2", "one-dep": "1.0.0" } });
    let lockfile = await lock(dir);
    expect(lockfile).toContain('"a-dep@1.0.2"');
    expect(lockfile).toContain('"no-deps@1.0.1"');

    const { stdout, exitCode } = await auditFix(dir, "--json");
    expect(JSON.parse(stdout)).toMatchObject({
      dryRun: false,
      fixed: 1,
      remaining: 1,
      fixes: [{ name: "a-dep", from: "1.0.2", to: "1.0.4" }],
      blocked: [{ name: "no-deps", from: "1.0.1", needs: "1.1.0", blockers: [{ dependent: "one-dep@1.0.0" }] }],
      vulnerableAfterInstall: [],
    });
    expect(exitCode).toBe(1);

    lockfile = await lock(dir);
    expect(lockfile).toContain('"a-dep@1.0.4"');
    expect(await installedVersion(dir, "a-dep")).toBe("1.0.4");
  });

  test.concurrent("audits and fixes a package served by a scoped registry", async () => {
    await using scoped = startRegistry({ "@types/is-number": [adv("<2.0.0")] });
    await using server = startRegistry({});
    using dir = await setup(
      server,
      { name: "foo", dependencies: { "@types/is-number": "1.0.0" } },
      {},
      {
        types: scoped.url.href,
      },
    );
    await reinstall(dir, { name: "foo", dependencies: { "@types/is-number": ">=1.0.0" } });
    expect(await lock(dir)).toContain('"@types/is-number@1.0.0"');

    const before = await audit(dir);
    expect(before.stdout).toContain("@types/is-number");
    expect(before.stdout).not.toContain("Skipped");
    expect(before.exitCode).toBe(1);

    const { stdout, exitCode } = await auditFix(dir);
    expect(stdout).toContain("@types/is-number@1.0.0 → 2.0.0");
    expect(stdout).not.toContain("Skipped");
    expect(exitCode).toBe(0);
    expect(await installedVersion(dir, "@types", "is-number")).toBe("2.0.0");

    const recheck = await audit(dir);
    expect(recheck.stdout).toBe("No vulnerabilities found\n");
    expect(recheck.exitCode).toBe(0);
  });

  test.concurrent("a scoped registry that does not answer the audit request is reported", async () => {
    await using scoped = startRegistry({}, { bulkStatus: 404 });
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")] });
    using dir = await setup(
      server,
      { name: "foo", dependencies: { "@types/is-number": "1.0.0", "a-dep": "1.0.2" } },
      {},
      {
        types: scoped.url.href,
      },
    );
    const skipped = `Skipped @types/is-number because ${registryHref(scoped)} could not be audited`;

    const report = await audit(dir);
    expect(report.stdout).toContain(skipped);
    expect(report.stdout).toContain("a-dep");
    expect(report.stdout).toContain("1 vulnerability (1 high)");
    expect(report.exitCode).toBe(1);

    const dryRun = await auditFix(dir, "--dry-run");
    expect(dryRun.stdout).toContain(skipped);
    expect(dryRun.stdout).toContain("Would fix 1 vulnerability in 1 package");
    expect(dryRun.exitCode).toBe(0);
  });
});
