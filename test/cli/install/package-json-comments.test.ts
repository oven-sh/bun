import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { exists } from "fs/promises";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

// `bun install` reads package.json with comments and trailing commas allowed. Every command below reads a
// package.json too, so it has to take the file that `bun install` takes.
const dialects = [
  ["a trailing comma", (pkg: object) => JSON.stringify(pkg, null, 2).replace(/\n}$/, ",\n}\n")],
  ["a comment", (pkg: object) => JSON.stringify(pkg, null, 2).replace(/^{/, "{\n  // note") + "\n"],
] as const;

const tarball = (files: Record<string, string>) => new Bun.Archive(files, { compress: "gzip" }).bytes();
// A command that writes package.json back can keep the comments or drop them. Both are read here.
const readManifest = async (path: string) => Bun.JSONC.parse(await Bun.file(path).text());

// A registry that has every package name at 1.0.0 and 2.0.0 (latest).
let registry: ReturnType<typeof Bun.serve>;
beforeAll(() => {
  registry = Bun.serve({
    port: 0,
    async fetch(req) {
      const [name, , file] = decodeURIComponent(new URL(req.url).pathname).slice(1).split("/");
      if (file === undefined) {
        const versions: Record<string, object> = {};
        for (const version of ["1.0.0", "2.0.0"]) {
          const dist = { tarball: `${registry.url.origin}/${name}/-/${name}-${version}.tgz` };
          versions[version] = { name, version, dist };
        }
        return Response.json({ name, "dist-tags": { latest: "2.0.0" }, versions });
      }
      const version = file.slice(name.length + 1, -".tgz".length);
      return new Response(
        await tarball({
          "package/package.json": JSON.stringify({ name, version }),
          "package/index.js": `module.exports = "${version}";\n`,
        }),
      );
    },
  });
});
afterAll(() => registry?.stop(true));

async function run(cwd: string, args: string[], env: Record<string, string> = {}) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd,
    env: { ...bunEnv, NPM_CONFIG_REGISTRY: registry.url.origin, BUN_CONFIG_REGISTRY: registry.url.origin, ...env },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe.each(dialects)("a package.json with %s", (_, write) => {
  describe.concurrent("bun pm trust", () => {
    const cache = (root: string) => ({ BUN_INSTALL_CACHE_DIR: join(root, ".cache") });
    const ran = (root: string) => exists(join(root, "node_modules", "q", "ran.txt"));

    // `q` has a postinstall script. `bun install` blocks it until `q` is trusted.
    async function installUntrusted(root: string) {
      const q = { name: "q", version: "1.0.0", scripts: { postinstall: "echo ran > ran.txt" } };
      await Bun.write(join(root, "q.tgz"), await tarball({ "package/package.json": JSON.stringify(q) }));
      expect(await run(root, ["install"], cache(root))).toMatchObject({
        stderr: expect.not.stringContaining("error:"),
        exitCode: 0,
      });
      expect(await ran(root)).toBeFalse();
    }

    const trusted = {
      stdout: expect.stringContaining("1 script ran across 1 package"),
      stderr: expect.not.stringContaining("error:"),
      exitCode: 0,
    };

    async function expectRecorded(root: string, manifest: object) {
      expect(await ran(root)).toBeTrue();
      expect(await readManifest(join(root, "package.json"))).toEqual({ ...manifest, trustedDependencies: ["q"] });
      expect(await Bun.file(join(root, "bun.lock")).text()).toContain(`"trustedDependencies": [\n    "q",\n  ],`);
    }

    test("runs the script and records the trust", async () => {
      const manifest = { name: "app", dependencies: { q: "file:./q.tgz" } };
      using dir = tempDir("package-json-comments-trust", { "package.json": write(manifest) });
      const root = String(dir);
      await installUntrusted(root);

      expect(await run(root, ["pm", "trust", "q"], cache(root))).toEqual(trusted);
      await expectRecorded(root, manifest);
    });

    test("--all from a workspace member records the trust in the workspace root", async () => {
      const manifest = { name: "app", workspaces: ["packages/*"], dependencies: { q: "file:./q.tgz" } };
      using dir = tempDir("package-json-comments-trust-all", {
        "package.json": write(manifest),
        "packages/member/package.json": JSON.stringify({ name: "member", version: "1.0.0" }),
      });
      const root = String(dir);
      await installUntrusted(root);

      const member = join(root, "packages", "member");
      expect(await run(member, ["pm", "trust", "--all"], cache(root))).toEqual(trusted);
      await expectRecorded(root, manifest);
    });
  });

  describe.concurrent("bun pm diff", () => {
    test("the notes report a new install script", async () => {
      using dir = tempDir("package-json-comments-notes", {});
      const before = { name: "diffme", version: "1.0.0" };
      const after = { name: "diffme", version: "2.0.0", scripts: { postinstall: "node setup.js" } };
      await Bun.write(join(String(dir), "a.tgz"), await tarball({ "package/package.json": JSON.stringify(before) }));
      await Bun.write(join(String(dir), "b.tgz"), await tarball({ "package/package.json": write(after) }));

      const { stdout, stderr, exitCode } = await run(String(dir), ["pm", "diff", "./a.tgz", "./b.tgz", "--json"]);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout).notes).toEqual(["postinstall script added: node setup.js"]);
      expect(exitCode).toBe(0);
    });

    test("a folder is read as `bun pm pack` would publish it", async () => {
      using dir = tempDir("package-json-comments-folder", {
        "a/package.json": JSON.stringify({ name: "p", version: "1.0.0", files: ["index.js"] }),
        "a/index.js": "module.exports = 1;\n",
        "b/package.json": write({ name: "p", version: "1.0.1", files: ["index.js"] }),
        "b/index.js": "module.exports = 2;\n",
        "b/secret.txt": "not in `files`\n",
      });

      const { stdout, stderr, exitCode } = await run(String(dir), ["pm", "diff", "./a", "./b", "--name-only"]);
      expect(stderr).toBe("");
      expect(stdout.split("\n").filter(line => /^[AMD] /.test(line))).toEqual(["M index.js", "M package.json"]);
      expect(exitCode).toBe(0);
    });

    test("a folder then a bare version: the registry side takes the package name of the folder", async () => {
      using dir = tempDir("package-json-comments-name", {
        "pkg/package.json": write({ name: "diffme", version: "3.0.0" }),
      });

      const { stdout, stderr, exitCode } = await run(String(dir), ["pm", "diff", "./pkg", "1.0.0", "--name-only"]);
      expect(stderr).toBe("");
      expect(stdout.split("\n")[0]).toBe("./pkg → diffme@1.0.0");
      expect(exitCode).toBe(0);
    });

    test("no arguments inside the package folder: what is published → this folder", async () => {
      using dir = tempDir("package-json-comments-cwd", {
        "package.json": write({ name: "diffme", version: "3.0.0" }),
      });

      const { stdout, stderr, exitCode } = await run(String(dir), ["pm", "diff", "--name-only"]);
      expect(stderr).toBe("");
      expect(stdout.split("\n")[0]).toBe("diffme@2.0.0 → .");
      expect(exitCode).toBe(0);
    });
  });

  describe.concurrent("bun info, bun pm view", () => {
    test.each(["info", "pm view"])("bun %s with no name looks up the name in package.json", async command => {
      using dir = tempDir("package-json-comments-info", {
        "package.json": write({ name: "named-in-package-json", version: "1.0.0" }),
      });

      const { stdout, stderr, exitCode } = await run(String(dir), [...command.split(" "), "--json"]);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout).name).toBe("named-in-package-json");
      expect(exitCode).toBe(0);
    });
  });

  // A template from GitHub takes the same read. Its cases are in bun-create.test.ts, with the other GitHub templates.
  test.concurrent("bun create: a local template gets the package.json transforms", async () => {
    const template = { name: "template", version: "1.0.0", "bun-create": { start: "bun run go" } };
    using dir = tempDir("package-json-comments-create", {
      "templates/template/package.json": write(template),
    });

    const created = await run(String(dir), ["create", "template", "dest", "--no-git"], {
      BUN_CREATE_DIR: join(String(dir), "templates"),
    });
    expect(created).toEqual({
      stdout: expect.stringContaining("\n  cd dest\n  bun run go\n"),
      stderr: expect.not.stringContaining("error:"),
      exitCode: 0,
    });
    expect(await readManifest(join(String(dir), "dest", "package.json"))).toEqual({
      name: "dest",
      version: "1.0.0",
    });
  });
});
