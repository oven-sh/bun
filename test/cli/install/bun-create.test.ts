import { spawn, spawnSync } from "bun";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, lstatSync, mkdirSync, readdirSync, statSync, symlinkSync } from "fs";
import { exists, stat } from "fs/promises";
import { bunExe, bunEnv as env, githubTarball, isASAN, isPosix, tempDir, tls, tmpdirSync } from "harness";
import { once } from "node:events";
import * as nodetls from "node:tls";
import { delimiter, join } from "path";
import { TestRegistry } from "registry";
import { gzipSync } from "zlib";

const registry = new TestRegistry();
beforeAll(() => registry.start());
afterAll(() => registry.stop());

let x_dir: string;

let testNumber = 0;
beforeEach(async () => {
  x_dir = tmpdirSync(`cr8-${testNumber++}`);
});

describe("should not crash", async () => {
  const args = [
    [bunExe(), "create"],
    [bunExe(), "create", ""],
    [bunExe(), "create", "--"],
    [bunExe(), "create", "--", ""],
    [bunExe(), "create", "--help"],
  ];
  for (let cmd of args) {
    it(JSON.stringify(cmd.slice(1)), () => {
      const { exitCode } = spawnSync({
        cmd,
        cwd: x_dir,
        stdout: "ignore",
        stdin: "inherit",
        stderr: "inherit",
        env,
      });
      expect(exitCode).toBe(cmd.length === 2 ? 1 : 0);
    });
  }
});

it.concurrent.each([
  ["@quick-start/some-template", "@quick-start%2fcreate-some-template"],
  ["@second-quick-start", "@second-quick-start%2fcreate"],
  ["@second-quick-start@1.0.0", "@second-quick-start%2fcreate"],
])("should create selected template with @ prefix: %s", async (template, requested) => {
  using dir = tempDir("create-at-prefix", {});
  const { err, exitCode } = await create(String(dir), [template], { npm_config_registry: registry.url });

  expect(err.split(/\r?\n/)).toContain(`error: GET ${registry.url}${requested} - 404`);
  expect(exitCode).toBe(1);
});

// Close-delimited body (no Content-Length, no chunked) split across packets:
// send_sync must wait for the terminal callback, not return on the first
// progress update. https://github.com/oven-sh/bun/pull/34425
it("handles a close-delimited GitHub tarball body split across packets", async () => {
  // Single-member tar (package.json at depth 1) gzipped into the body.
  const pkg = Buffer.from(
    JSON.stringify({
      name: "split-body-template",
      "bun-create": { start: "bun run ok" },
    }),
  );
  const tar = Buffer.alloc(512 + ((pkg.length + 511) & ~511) + 1024);
  const header = tar.subarray(0, 512);
  header.write("pkg/package.json");
  header.write("0000644", 100);
  header.write("0000000", 108);
  header.write("0000000", 116);
  header.write(pkg.length.toString(8).padStart(11, "0"), 124);
  header.write("00000000000", 136);
  header.write("        ", 148);
  header.write("0", 156);
  header.write("ustar\0", 257);
  header.write("00", 263);
  let sum = 0;
  for (const b of header) sum += b;
  header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
  pkg.copy(tar, 512);
  const gz = gzipSync(tar);

  // Raw TLS server: no Content-Length, no chunked; body ends at FIN.
  const sockets = new Set<nodetls.TLSSocket>();
  const server = nodetls.createServer({ cert: tls.cert, key: tls.key }, socket => {
    sockets.add(socket);
    socket.setNoDelay(true);
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
    socket.once("data", () => {
      socket.write("HTTP/1.1 200 OK\r\ncontent-type: application/x-gzip\r\nconnection: close\r\n\r\n");
      // Drip the body in many fragments, each on its own tick, so the client
      // cannot coalesce them all into a single on_data() before the first one
      // reaches its poll loop.
      const step = Math.max(1, Math.floor(gz.length / 12));
      let i = 0;
      const push = () => {
        if (i >= gz.length) return socket.end();
        socket.write(gz.subarray(i, (i += step)));
        setImmediate(push);
      };
      push();
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as import("node:net").AddressInfo).port;

  try {
    await using proc = spawn({
      cmd: [bunExe(), "create", "github.com/owner/split-body-template", "--no-install", "--no-git"],
      cwd: x_dir,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...env,
        NODE_TLS_REJECT_UNAUTHORIZED: "0",
        GITHUB_API_DOMAIN: `127.0.0.1:${port}`,
      },
    });

    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ out, err, exitCode, signalCode: proc.signalCode }).toEqual({
      out: expect.stringContaining("Success! owner/split-body-template loaded into split-body-template"),
      err: expect.not.stringContaining("error:"),
      exitCode: 0,
      signalCode: null,
    });
    expect(out).toContain("bun run ok");
    expect(await Bun.file(join(x_dir, "split-body-template", "package.json")).json()).toEqual({
      name: "split-body-template",
    });
  } finally {
    for (const s of sockets) s.destroy();
    await new Promise<void>(r => server.close(() => r()));
  }
});

function tarEntry(name: string, body: Buffer) {
  const buf = Buffer.alloc(512 + ((body.length + 511) & ~511));
  const header = buf.subarray(0, 512);
  header.write(name);
  header.write("0000644", 100);
  header.write("0000000", 108);
  header.write("0000000", 116);
  header.write(body.length.toString(8).padStart(11, "0"), 124);
  header.write("00000000000", 136);
  header.write("        ", 148);
  header.write("0", 156);
  header.write("ustar\0", 257);
  header.write("00", 263);
  let sum = 0;
  for (const b of header) sum += b;
  header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
  body.copy(buf, 512);
  return buf;
}

it("keeps tarball entry paths within the destination when checking for conflicting files", async () => {
  const pkg = Buffer.from(
    JSON.stringify({
      name: "conflict-check-template",
      "bun-create": { start: "bun run ok" },
    }),
  );
  const gz = gzipSync(
    Buffer.concat([
      tarEntry("pkg/../outside.txt", Buffer.from("from-tarball")),
      tarEntry("pkg/package.json", pkg),
      Buffer.alloc(1024),
    ]),
  );

  mkdirSync(join(x_dir, "dest"));
  await Bun.write(join(x_dir, "outside.txt"), "keep me");

  using server = Bun.serve({
    tls,
    port: 0,
    fetch() {
      return new Response(gz, { headers: { "content-type": "application/x-gzip" } });
    },
  });

  await using proc = spawn({
    cmd: [bunExe(), "create", "github.com/owner/conflict-check-template", "dest", "--no-install", "--no-git"],
    cwd: x_dir,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...env,
      NODE_TLS_REJECT_UNAUTHORIZED: "0",
      GITHUB_API_DOMAIN: `${server.hostname}:${server.port}`,
    },
  });

  const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(err).not.toContain("could conflict");
  expect(out).toContain("Success! owner/conflict-check-template loaded into dest");
  expect(await Bun.file(join(x_dir, "outside.txt")).text()).toBe("keep me");
  expect(exitCode).toBe(0);
});

// `\` separates as well, so this entry is `nested.txt` in `sub`.
it("sees a link in the destination behind a `\\` in the name of a tarball entry", async () => {
  const gz = gzipSync(Buffer.concat([tarEntry("pkg/sub\\nested.txt", Buffer.from("template")), Buffer.alloc(1024)]));
  mkdirSync(join(x_dir, "dest"));
  mkdirSync(join(x_dir, "outside"));
  symlinkSync(join(x_dir, "outside"), join(x_dir, "dest", "sub"), "junction");

  using server = Bun.serve({
    tls,
    port: 0,
    fetch() {
      return new Response(gz, { headers: { "content-type": "application/x-gzip" } });
    },
  });

  const { err, exitCode } = await create(
    x_dir,
    ["github.com/owner/backslash-template", "dest", "--no-install", "--no-git"],
    { NODE_TLS_REJECT_UNAUTHORIZED: "0", GITHUB_API_DOMAIN: `${server.hostname}:${server.port}` },
  );

  expect(err).toContain("contains files that could conflict");
  expect(readdirSync(join(x_dir, "outside"))).toEqual([]);
  expect(exitCode).toBe(1);
});

it("reports an error and exits when the template's package.json entry body is truncated", async () => {
  const header = Buffer.alloc(512);
  header.write("pkg/package.json");
  header.write("0000644", 100);
  header.write("0000000", 108);
  header.write("0000000", 116);
  header.write((4096).toString(8).padStart(11, "0"), 124);
  header.write("00000000000", 136);
  header.write("        ", 148);
  header.write("0", 156);
  header.write("ustar\0", 257);
  header.write("00", 263);
  let sum = 0;
  for (const b of header) sum += b;
  header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
  const gz = gzipSync(header);

  using server = Bun.serve({
    tls,
    port: 0,
    fetch() {
      return new Response(gz, { headers: { "content-type": "application/x-gzip" } });
    },
  });

  await using proc = spawn({
    cmd: [bunExe(), "create", "github.com/owner/truncated-template", "dest", "--force", "--no-install", "--no-git"],
    cwd: x_dir,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...env,
      NODE_TLS_REJECT_UNAUTHORIZED: "0",
      GITHUB_API_DOMAIN: `${server.hostname}:${server.port}`,
    },
  });

  const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(err).toContain("Unexpected");
  expect(out).not.toContain("Success!");
  expect(proc.signalCode).toBeNull();
  expect(exitCode).toBe(1);
});

it("does not size the package.json buffer from the size in the template tarball's header", async () => {
  // The header declares 2 GiB. The archive holds 26 bytes.
  const declared = 2 * 1024 * 1024 * 1024;
  const body = Buffer.from('{"name":"lying-template"}\n');
  const header = Buffer.alloc(512);
  header.write("pkg/package.json");
  header.write("0000644", 100);
  header.write("0000000", 108);
  header.write("0000000", 116);
  header.write(declared.toString(8).padStart(11, "0"), 124);
  header.write("00000000000", 136);
  header.write("        ", 148);
  header.write("0", 156);
  header.write("ustar\0", 257);
  header.write("00", 263);
  let sum = 0;
  for (const b of header) sum += b;
  header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
  const gz = gzipSync(Buffer.concat([header, body, Buffer.alloc(512 - body.length), Buffer.alloc(1024)]));

  using server = Bun.serve({
    tls,
    port: 0,
    fetch() {
      return new Response(gz, { headers: { "content-type": "application/x-gzip" } });
    },
  });

  // The peak memory of a child is never reported below the peak of the
  // process that spawned it. A child that does nothing gives that floor.
  await using idle = spawn({ cmd: [bunExe(), "--version"], env, stdout: "ignore", stderr: "ignore" });
  await idle.exited;
  const floor = idle.resourceUsage()!.maxRSS;

  await using proc = spawn({
    cmd: [bunExe(), "create", "github.com/owner/lying-template", "dest", "--force", "--no-install", "--no-git"],
    cwd: x_dir,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...env,
      NODE_TLS_REJECT_UNAUTHORIZED: "0",
      GITHUB_API_DOMAIN: `${server.hostname}:${server.port}`,
    },
  });

  const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(err).toContain("Unexpected");
  expect(out).not.toContain("Success!");
  expect(proc.signalCode).toBeNull();
  expect(proc.resourceUsage()!.maxRSS - floor).toBeLessThan(declared / 2);
  expect(exitCode).toBe(1);
});

const gitIdentity = {
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t.t",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t.t",
};

/** `bun create ...args` in `cwd`; local templates are looked up in `<cwd>/bun-create`. */
async function create(cwd: string, args: string[], extraEnv: Record<string, string | undefined> = {}) {
  const merged = { ...env, BUN_CREATE_DIR: join(cwd, "bun-create"), ...extraEnv };
  await using proc = spawn({
    cmd: [bunExe(), "create", ...args],
    cwd,
    env: merged,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { out, err, exitCode };
}

async function git(cwd: string, ...args: string[]) {
  await using proc = spawn({
    cmd: ["git", ...args],
    cwd,
    env: { ...env, ...gitIdentity },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { out: out.trim(), err, exitCode };
}

describe.concurrent("git", () => {
  const localdep = {
    "bun-create/tmpl/index.js": "// hi\n",
    "bun-create/tmpl/localdep/package.json": JSON.stringify({ name: "localdep", version: "1.0.0" }),
  };

  // git used to run on a thread next to the tasks and `bun install`, so `git add` indexed what they wrote.
  it("commits exactly the template, before the tasks and the install", async () => {
    using dir = tempDir("create-git-first-commit", {
      ...localdep,
      "bun-create/tmpl/package.json": JSON.stringify({
        name: "tmpl",
        version: "1.0.0",
        dependencies: { localdep: "file:./localdep" },
      }),
    });
    const { out, err, exitCode } = await create(String(dir), ["tmpl", "dest"], gitIdentity);

    expect(err).not.toContain("error:");
    expect(out).toContain("A local git repository was created for you and dependencies were installed automatically.");
    const dest = join(String(dir), "dest");
    expect((await git(dest, "ls-tree", "-r", "--name-only", "HEAD")).out.split("\n")).toEqual([
      "index.js",
      "localdep/package.json",
      "package.json",
    ]);
    expect(await exists(join(dest, "node_modules", "localdep", "package.json"))).toBe(true);
    expect(exitCode).toBe(0);
  });

  // The stub `git` logs the files each call sees. POSIX-only: it is a shell script.
  it.skipIf(!isPosix)("runs every git command before the first task", async () => {
    using dir = tempDir("create-git-order", {
      ...localdep,
      "bin/git": `#!/bin/sh\necho "$1" $(LC_ALL=C ls -A) >> "$GIT_LOG"\n`,
      "bun-create/tmpl/package.json": JSON.stringify({
        name: "tmpl",
        version: "1.0.0",
        scripts: { pre: "echo pre > pre.txt", post: "echo post > post.txt" },
        dependencies: { localdep: "file:./localdep" },
        "bun-create": { preinstall: "pre", postinstall: "post" },
      }),
    });
    const root = String(dir);
    chmodSync(join(root, "bin", "git"), 0o755);

    const { out, err, exitCode } = await create(root, ["tmpl", "dest"], {
      PATH: join(root, "bin") + ":" + process.env.PATH,
      GIT_LOG: join(root, "git.log"),
    });

    expect((await Bun.file(join(root, "git.log")).text()).trim().split("\n")).toEqual([
      "init index.js localdep package.json",
      "add index.js localdep package.json",
      "commit index.js localdep package.json",
    ]);
    expect(out).toContain("$ bun install");
    expect(err).not.toContain("error:");
    expect(err.indexOf("] git")).toBeGreaterThan(-1);
    expect(err.indexOf("] git")).toBeLessThan(err.indexOf("] bun install"));
    expect(await Bun.file(join(root, "dest", "pre.txt")).text()).toBe("pre\n");
    expect(await Bun.file(join(root, "dest", "post.txt")).text()).toBe("post\n");
    expect(exitCode).toBe(0);
  });

  // `git commit` printed its ten-line "Please tell me who you are" banner.
  it("skips the commit with one line when git has no identity", async () => {
    using dir = tempDir("create-no-git-identity", {
      // Turns off git's guess from the user and host name, so that no machine has an identity.
      "home/.gitconfig": "[user]\n\tuseConfigOnly = true\n",
      "bun-create/tmpl/package.json": JSON.stringify({ name: "tmpl", version: "1.0.0" }),
      "bun-create/tmpl/index.js": "// hi\n",
    });
    const noIdentity = {
      ...Object.fromEntries(
        Object.keys(env)
          .filter(key => key.startsWith("GIT_") || key === "EMAIL" || key === "XDG_CONFIG_HOME")
          .map(key => [key, undefined]),
      ),
      HOME: join(String(dir), "home"),
      USERPROFILE: join(String(dir), "home"),
      GIT_CONFIG_NOSYSTEM: "1",
    };

    const { out, err, exitCode } = await create(String(dir), ["tmpl", "dest"], noIdentity);

    expect(err.split("\n").filter(line => /git|fatal|\*\*\*/i.test(line) && !line.includes("bun create"))).toEqual([
      "note: git has no user.name and user.email, files staged but not committed",
      expect.stringMatching(/^\[.*\] git$/),
    ]);
    expect(out).toContain("A local git repository was created for you.");
    const dest = join(String(dir), "dest");
    expect((await git(dest, "diff", "--cached", "--name-only")).out.split("\n")).toEqual(["index.js", "package.json"]);
    expect((await git(dest, "rev-parse", "--verify", "--quiet", "HEAD")).exitCode).toBe(1);
    expect(exitCode).toBe(0);
  });

  // With nothing to install, git's outcome was stored without the `!`.
  it.skipIf(!isPosix)("reports the git repository when there is nothing to install", async () => {
    using dir = tempDir("create-git-no-deps", {
      "bin/git": "#!/bin/sh\nexit 0\n",
      "empty/.keep": "",
      "bun-create/tmpl/index.js": "// hi\n",
      "bun-create/tmpl/package.json": JSON.stringify({ name: "tmpl", version: "1.0.0" }),
    });
    const root = String(dir);
    chmodSync(join(root, "bin", "git"), 0o755);

    // The directory is the whole PATH, so `git` is found only in "bin".
    const withGit = await create(root, ["tmpl", "dest-bin"], { PATH: join(root, "bin") });
    expect(withGit.err).not.toContain("error:");
    expect(withGit.err).toContain("] git");
    expect(withGit.out).toContain("A local git repository was created for you.");
    expect(withGit.exitCode).toBe(0);

    const withoutGit = await create(root, ["tmpl", "dest-empty"], { PATH: join(root, "empty") });
    expect(withoutGit.err).not.toContain("error:");
    expect(withoutGit.err).not.toContain("] git");
    expect(withoutGit.out).not.toContain("A local git repository");
    expect(withoutGit.exitCode).toBe(0);
  });
});

// The status of the nested `bun install` used to be dropped: "Created ... successfully", exit 0.
describe.concurrent("when the nested `bun install` fails", () => {
  it.each([
    {
      name: "an unresolvable dependency",
      packageJson: { dependencies: { "bun-create-missing-dep": "1.0.0" } },
      code: 1,
    },
    {
      name: "a failing postinstall script",
      packageJson: { dependencies: { localdep: "file:./localdep" }, scripts: { postinstall: "exit 3" } },
      code: 3,
    },
    // `bun install` re-raises the signal on itself; reported the way shells do.
    ...(isPosix
      ? [
          {
            name: "a postinstall script killed by SIGKILL",
            packageJson: {
              dependencies: { localdep: "file:./localdep" },
              scripts: { postinstall: "sh -c 'kill -9 $$'" },
            },
            code: 128 + 9,
          },
        ]
      : []),
  ])("because of $name: exits with its code and skips the postinstall tasks", async ({ packageJson, code }) => {
    using registry = Bun.serve({ port: 0, fetch: () => new Response("not found", { status: 404 }) });
    using dir = tempDir("create-install-fails", {
      "bun-create/tmpl/index.js": "// hi\n",
      "bun-create/tmpl/localdep/package.json": JSON.stringify({ name: "localdep", version: "1.0.0" }),
      "bun-create/tmpl/package.json": JSON.stringify({
        name: "tmpl",
        version: "1.0.0",
        ...packageJson,
        "bun-create": { preinstall: "echo pre > PRE_RAN", postinstall: "echo post > POST_RAN" },
      }),
    });
    const dest = join(String(dir), "dest");

    const { out, err, exitCode } = await create(String(dir), ["tmpl", "dest", "--no-git"], {
      BUN_CONFIG_REGISTRY: String(registry.url),
      BUN_INSTALL_CACHE_DIR: join(String(dir), ".bun-cache"),
    });

    expect(err).toMatch(new RegExp(`error: bun install failed in "[^"]*dest" \\(code: ${code}\\)`));
    expect(err).toContain("note: template files were written. run bun install there once the error is fixed");
    expect(out).toContain("$ bun install");
    expect(out).not.toContain("installed automatically");
    expect(out).not.toContain("successfully");
    expect(out).not.toContain("To get started");
    expect(await exists(join(dest, "index.js"))).toBe(true);
    expect(await exists(join(dest, "PRE_RAN"))).toBe(true);
    expect(await exists(join(dest, "POST_RAN"))).toBe(false);
    expect(exitCode).toBe(code);
  });
});

it("should create template from local folder", async () => {
  const bunCreateDir = join(x_dir, "bun-create");
  const testTemplate = "test-template";

  await Bun.write(join(bunCreateDir, testTemplate, "index.js"), "hi");
  await Bun.write(join(bunCreateDir, testTemplate, "foo", "bar.js"), "hi");

  const { exited } = spawn({
    cmd: [bunExe(), "create", testTemplate],
    cwd: x_dir,
    stdout: "inherit",
    stdin: "inherit",
    stderr: "inherit",
    env: { ...env, BUN_CREATE_DIR: bunCreateDir },
  });

  expect(await exited).toBe(0);

  const dirStat = await stat(join(x_dir, testTemplate));
  expect(dirStat.isDirectory()).toBe(true);
  expect(await Bun.file(join(x_dir, testTemplate, "index.js")).text()).toBe("hi");
  expect(await Bun.file(join(x_dir, testTemplate, "foo", "bar.js")).text()).toBe("hi");
});

async function tree(dir: string) {
  const files: Record<string, string> = {};
  for (const path of (await Array.fromAsync(new Bun.Glob("**").scan({ cwd: dir, dot: true }))).sort()) {
    files[path.replaceAll("\\", "/")] = await Bun.file(join(dir, path)).text();
  }
  return files;
}

// A local template used to delete the destination first: `bun create tpl .` removed the cwd.
describe.concurrent("local template into an existing directory", () => {
  /** `bun create tpl . ...args` in `<dir>/proj`, templates in `<dir>/bun-create`. */
  const createInProj = (dir: string, ...args: string[]) =>
    create(join(dir, "proj"), ["tpl", ".", "--no-git", ...args], { BUN_CREATE_DIR: join(dir, "bun-create") });

  it("keeps every file the template does not have", async () => {
    using dir = tempDir("create-local-keep", {
      "bun-create/tpl/tpl.txt": "template",
      "proj/important.txt": "mine",
      "proj/sub/data.txt": "mine",
      "proj/.npmignore": "mine",
      "proj/gitignore": "mine",
      "proj/package.json": `{"name":"mine","dependencies":{"missing":"file:./missing"},"bun-create":{"start":"x"}}`,
    });
    const { out, err, exitCode } = await createInProj(String(dir));

    expect(err).not.toContain("error");
    expect(out).not.toContain("$ bun install");
    expect(await tree(join(String(dir), "proj"))).toEqual({
      ".npmignore": "mine",
      "gitignore": "mine",
      "important.txt": "mine",
      "package.json": `{"name":"mine","dependencies":{"missing":"file:./missing"},"bun-create":{"start":"x"}}`,
      "sub/data.txt": "mine",
      "tpl.txt": "template",
    });
    expect(exitCode).toBe(0);
  });

  const conflicting = {
    "bun-create/tpl/index.ts": "template",
    "bun-create/tpl/new.txt": "template",
    "bun-create/tpl/sub/nested.ts": "template",
    "bun-create/tpl/README.md": "template",
    "bun-create/tpl/.gitignore": "template",
    "proj/index.ts": "mine",
    "proj/keep.txt": "mine",
    "proj/sub/nested.ts": "",
    "proj/README.md": "mine",
    "proj/.gitignore": "mine",
  };

  it("lists the files it would overwrite and writes nothing", async () => {
    using dir = tempDir("create-local-conflict", conflicting);
    const { err, exitCode } = await createInProj(String(dir));

    const message = err.slice(err.indexOf("error:")).replaceAll("\\", "/");
    expect(message.split("\n").filter(Boolean).sort()).toEqual([
      "  .gitignore",
      "  index.ts",
      "  sub/nested.ts",
      "To overwrite them, use --force",
      "error: The directory proj/ contains files that could conflict:",
    ]);
    expect(await tree(join(String(dir), "proj"))).toEqual({
      ".gitignore": "mine",
      "README.md": "mine",
      "index.ts": "mine",
      "keep.txt": "mine",
      "sub/nested.ts": "",
    });
    expect(exitCode).toBe(1);
  });

  it("--force overwrites and deletes nothing", async () => {
    using dir = tempDir("create-local-force", conflicting);
    const { err, exitCode } = await createInProj(String(dir), "--force");

    expect(err).not.toContain("error");
    expect(await tree(join(String(dir), "proj"))).toEqual({
      ".gitignore": "template",
      "README.md": "template",
      "index.ts": "template",
      "keep.txt": "mine",
      "new.txt": "template",
      "sub/nested.ts": "template",
    });
    expect(exitCode).toBe(0);
  });

  it("replaces README.md like a remote template", async () => {
    using dir = tempDir("create-local-never-conflict", {
      "bun-create/tpl/README.md": "template",
      "proj/README.md": "mine",
      "proj/.gitignore": "mine",
    });
    const { err, exitCode } = await createInProj(String(dir));

    expect(err).not.toContain("error");
    expect(await tree(join(String(dir), "proj"))).toEqual({ ".gitignore": "mine", "README.md": "template" });
    expect(exitCode).toBe(0);
  });

  it("still renames the template's gitignore and drops its .npmignore", async () => {
    using dir = tempDir("create-local-gitignore", {
      "bun-create/tpl/gitignore": "template",
      "bun-create/tpl/.npmignore": "template",
      "proj/keep.txt": "mine",
    });
    const { err, exitCode } = await createInProj(String(dir));

    expect(err).not.toContain("error");
    expect(await tree(join(String(dir), "proj"))).toEqual({ ".gitignore": "template", "keep.txt": "mine" });
    expect(exitCode).toBe(0);
  });

  it.each(["--no-install", "--force"])(
    "reports a .gitignore that the template's gitignore cannot replace (%s)",
    async flag => {
      using dir = tempDir("create-local-gitignore-dir", {
        "bun-create/tpl/gitignore": "template",
        "proj/.gitignore/inner.txt": "mine",
      });
      const { err, exitCode } = await createInProj(String(dir), flag);

      expect(err).toContain(": renaming gitignore to .gitignore\n");
      expect(await tree(join(String(dir), "proj"))).toEqual({
        ".gitignore/inner.txt": "mine",
        "gitignore": "template",
      });
      expect(exitCode).toBe(1);
    },
  );

  const otherKind = {
    "bun-create/tpl/README.md": "template",
    "bun-create/tpl/new.txt": "template",
    "bun-create/tpl/sub/nested.ts": "template",
  };

  // The copy stopped at it with EISDIR / ENOTDIR, after the files that come before it in the walk.
  it.each([
    ["a directory where the template has a file", "README.md/index.md", "  README.md"],
    // Windows reports a file on the way as ENOENT.
    ...(isPosix ? [["a file where the template has a directory", "sub", "  sub/nested.ts"]] : []),
  ])("lists %s and writes nothing", async (_, mine, listed) => {
    using dir = tempDir("create-local-other-kind", { ...otherKind, [`proj/${mine}`]: "mine" });
    const { err, exitCode } = await createInProj(String(dir));

    expect(err.slice(err.indexOf("error:")).split("\n").filter(Boolean)).toEqual([
      "error: The directory proj/ contains files that could conflict:",
      listed,
      "To overwrite them, use --force",
    ]);
    expect(await tree(join(String(dir), "proj"))).toEqual({ [mine]: "mine" });
    expect(exitCode).toBe(1);
  });

  it.each(["README.md/index.md", "sub"])("--force deletes nothing to make room: %s", async mine => {
    using dir = tempDir("create-local-other-kind-force", { ...otherKind, [`proj/${mine}`]: "mine" });
    const { err, exitCode } = await createInProj(String(dir), "--force");

    expect(err).toContain(": failed to copy file ");
    expect(await tree(join(String(dir), "proj"))).toMatchObject({ [mine]: "mine" });
    expect(exitCode).toBe(1);
  });

  it("does not copy a template's .git file", async () => {
    using dir = tempDir("create-local-git-file", {
      "bun-create/tpl/.git": "gitdir: /somewhere/else/.git/worktrees/tpl",
      "bun-create/tpl/tpl.txt": "template",
      "proj/keep.txt": "mine",
    });
    const { err, exitCode } = await createInProj(String(dir));

    expect(err).not.toContain("error");
    expect(await tree(join(String(dir), "proj"))).toEqual({ "keep.txt": "mine", "tpl.txt": "template" });
    expect(exitCode).toBe(0);
  });

  it("leaves the destination's git repository alone", async () => {
    using dir = tempDir("create-local-existing-repo", {
      "bun-create/tpl/tpl.txt": "template",
      "proj/mine.txt": "mine",
    });
    const proj = join(String(dir), "proj");
    for (const args of [
      ["init", "--quiet"],
      ["add", "."],
      ["commit", "--quiet", "-m", "mine"],
    ]) {
      expect((await git(proj, ...args)).exitCode).toBe(0);
    }
    const head = (await git(proj, "rev-parse", "HEAD")).out;

    const { out, err, exitCode } = await create(proj, ["tpl", "."], {
      BUN_CREATE_DIR: join(String(dir), "bun-create"),
      ...gitIdentity,
    });

    expect(err).not.toContain("error");
    expect(err).not.toContain("] git");
    expect(out).not.toContain("git repository was created");
    expect((await git(proj, "rev-parse", "HEAD")).out).toBe(head);
    expect((await git(proj, "status", "--porcelain")).out).toBe("?? tpl.txt");
    expect(exitCode).toBe(0);
  });
});

describe.concurrent("template given as a path", () => {
  it("copies an absolute folder and keeps the destination's other files", async () => {
    using dir = tempDir("create-abs-template", {
      "templates/from-path/index.js": "hi",
      "templates/from-path/package.json": JSON.stringify({ name: "from-path", version: "1.0.0" }),
      "dest/keep.txt": "mine",
    });
    const root = String(dir);
    const { err, exitCode } = await create(root, [join(root, "templates", "from-path"), "dest", "--no-git"]);

    expect(err).not.toContain("error:");
    expect(await tree(join(root, "dest"))).toEqual({
      "index.js": "hi",
      "keep.txt": "mine",
      "package.json": JSON.stringify({ name: "dest", version: "1.0.0" }, null, 2) + "\n",
    });
    expect(exitCode).toBe(0);
  });

  // `--force` skips the conflict list, so only this check keeps the copy from truncating its own source.
  it.each([
    ["the template itself", "tmpl", "tmpl"],
    ["a folder inside the template", "tmpl", "tmpl/sub/dest"],
    ["the template behind a link", "link/tmpl", "real/tmpl"],
    ["a folder inside the template behind a link", "link/tmpl", "real/tmpl/sub/dest"],
  ])("refuses %s as the destination", async (_, template, destination) => {
    using dir = tempDir("create-into-template", {
      "tmpl/index.js": "hi",
      "real/tmpl/index.js": "hi",
    });
    const root = String(dir);
    symlinkSync(join(root, "real"), join(root, "link"), "junction");
    const before = await tree(root);

    const { err, exitCode } = await create(root, [
      join(root, template),
      join(root, destination),
      "--no-git",
      "--force",
    ]);

    expect(err).toContain("is inside template");
    expect(await tree(root)).toEqual(before);
    expect(exitCode).toBe(1);
  });

  // The lookup joins the name onto each template directory and folds `\` as well as `/`,
  // so `.` and `x\..` were `.bun-create` itself and `..` the project.
  it.each([".", "..", "x\\..", ""])("refuses %p as a template name", async name => {
    using dir = tempDir("create-bad-template-name", {
      "home/.keep": "",
      "proj/.bun-create/tmpl/index.js": "hi",
      "proj/keep.js": "mine",
    });
    const root = String(dir);
    const before = await tree(root);

    const { err, exitCode } = await create(join(root, "proj"), [name, "out", "--no-git"], {
      HOME: join(root, "home"),
      BUN_CREATE_DIR: undefined,
    });

    expect(err).toContain(`error: "${name}" is not a template name.`);
    expect(await tree(root)).toEqual(before);
    expect(exitCode).toBe(1);
  });

  // A path on Windows holds more than a command line.
  it.skipIf(!isPosix).each(["", "a/", "a@", "@a/", "./"])(
    "refuses a template name longer than a path: %p and 5000 bytes",
    async prefix => {
      using dir = tempDir("create-long-template-name", { "home/.keep": "", "proj/keep.js": "mine" });
      const root = String(dir);

      const { err, exitCode } = await create(join(root, "proj"), [prefix + Buffer.alloc(5000, "x").toString()], {
        HOME: join(root, "home"),
        BUN_CREATE_DIR: undefined,
      });

      expect(err).toBe("error: template name too long\n");
      expect(exitCode).toBe(1);
    },
  );
});

for (const [status, expected] of [
  [503, "error: GitHub returned a server error"],
  [429, "error: GitHub returned 429. This usually means GitHub is rate limiting your requests"],
  [403, "error: GitHub returned 403. This usually means GitHub is rate limiting your requests"],
] as const) {
  it(`should name GitHub in the error when the tarball request gets ${status}`, async () => {
    using server = Bun.serve({
      tls,
      port: 0,
      fetch() {
        return new Response("nope", { status });
      },
    });

    await using proc = spawn({
      cmd: [bunExe(), "create", "github.com/dylan-conway/create-test"],
      cwd: x_dir,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...env,
        NODE_TLS_REJECT_UNAUTHORIZED: "0",
        GITHUB_API_DOMAIN: `${server.hostname}:${server.port}`,
      },
    });

    const [, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(err).toContain(expected);
    expect(err).not.toContain("NPMIsDown");
    expect(err).not.toContain("An internal error occurred");
    expect(exitCode).toBe(1);
  });
}

/** Serves `files` as the tarball of every GitHub repository. `env` points `bun create` at it and at the test registry. */
async function serveGithub(files: Record<string, string>) {
  const tarball = await githubTarball("dylan-conway-create-test-0123abc", files);
  const requests: string[] = [];
  const server = Bun.serve({
    tls,
    port: 0,
    fetch(request) {
      requests.push(new URL(request.url).pathname);
      return new Response(tarball, { headers: { "content-type": "application/x-gzip" } });
    },
  });
  return {
    requests,
    env: {
      NODE_TLS_REJECT_UNAUTHORIZED: "0",
      GITHUB_API_DOMAIN: `${server.hostname}:${server.port}`,
      npm_config_registry: registry.url,
      ...gitIdentity,
    },
    [Symbol.dispose]: () => void server.stop(true),
  };
}

describe.concurrent("GitHub template", () => {
  const createTest = {
    "index.js": "// hi\n",
    "package.json": JSON.stringify({ name: "create-test", version: "1.0.0", dependencies: { "no-deps": "1.0.0" } }),
  };

  it("should not mention cd prompt when created in current directory", async () => {
    using github = await serveGithub(createTest);
    using dir = tempDir("create-github-cwd", {});
    const { out, err, exitCode } = await create(
      String(dir),
      ["https://github.com/dylan-conway/create-test", "."],
      github.env,
    );

    expect(err).not.toContain("error:");
    expect(out).toContain("\n# To get started, run:\n\n  bun dev\n\n");
    expect(exitCode).toBe(0);
  });

  it.skipIf(!isASAN)("doesn't leak memory at exit", async () => {
    using github = await serveGithub(createTest);
    using dir = tempDir("create-github-leak", {});
    const { out, err, exitCode } = await create(
      String(dir),
      ["dylan-conway/create-test", "dest", "--no-install", "--no-git"],
      {
        ...github.env,
        ASAN_OPTIONS: [env.ASAN_OPTIONS, "detect_leaks=1"].filter(Boolean).join(":"),
        LSAN_OPTIONS: `print_suppressions=0:suppressions=${join(import.meta.dirname, "../../leaksan.supp")}`,
      },
    );

    expect(out).toContain("Success! dylan-conway/create-test loaded into dest");
    expect(exitCode, err).toBe(0);
  });

  it.each(["https://github.com/dylan-conway/create-test", "github.com/dylan-conway/create-test"])(
    "should create and install github template from %s",
    async repo => {
      using github = await serveGithub(createTest);
      using dir = tempDir("create-github", {});
      const { out, err, exitCode } = await create(String(dir), [repo], github.env);

      expect(err).not.toContain("error:");
      expect(github.requests).toEqual(["/repos/dylan-conway/create-test/tarball"]);
      expect(out).toContain("Success! dylan-conway/create-test loaded into create-test");
      expect(await exists(join(String(dir), "create-test", "node_modules", "no-deps", "package.json"))).toBe(true);
      expect(exitCode).toBe(0);
    },
  );

  // The destination lost its .npmignore, and `git add` + `git commit` ran in the user's repository.
  it("leaves the .npmignore and the git repository of an existing destination alone", async () => {
    using github = await serveGithub({ "tpl.txt": "template" });
    using dir = tempDir("create-github-existing", {
      "dest/mine.txt": "mine",
      "dest/.npmignore": "mine",
      "dest/gitignore": "mine",
    });
    const dest = join(String(dir), "dest");
    for (const args of [
      ["init", "--quiet"],
      ["add", "."],
      ["commit", "--quiet", "-m", "mine"],
    ]) {
      expect((await git(dest, ...args)).exitCode).toBe(0);
    }
    const head = (await git(dest, "rev-parse", "HEAD")).out;

    const { out, err, exitCode } = await create(String(dir), ["dylan-conway/create-test", "dest"], github.env);

    expect(err).not.toContain("error:");
    expect(err).not.toContain("] git");
    expect(out).not.toContain("git repository was created");
    expect((await git(dest, "rev-parse", "HEAD")).out).toBe(head);
    expect((await git(dest, "status", "--porcelain")).out).toBe("?? tpl.txt");
    expect(exitCode).toBe(0);
  });

  it("lists the files it would overwrite", async () => {
    using github = await serveGithub({ "index.ts": "template", "sub/nested.ts": "template", "README.md": "template" });
    using dir = tempDir("create-github-conflict", {
      "dest/index.ts": "mine",
      "dest/sub/nested.ts": "mine",
      "dest/README.md": "mine",
    });
    const before = await tree(String(dir));

    const { err, exitCode } = await create(String(dir), ["dylan-conway/create-test", "dest", "--no-git"], github.env);

    const message = err.slice(err.indexOf("error:")).replaceAll("\\", "/");
    expect(message.split("\n").filter(Boolean).sort()).toEqual([
      "  index.ts",
      "  sub/",
      "To overwrite them, use --force",
      "error: The directory dest/ contains files that could conflict:",
    ]);
    expect(await tree(String(dir))).toEqual(before);
    expect(exitCode).toBe(1);
  });
});

describe.concurrent.each([
  ["local", "."],
  ["local", "proj"],
  ["GitHub", "."],
  ["GitHub", "proj"],
])("the .gitignore after `bun create <%s template> %s`", (kind, dest) => {
  /** `files` is what `proj` holds afterwards. With `mine`, it had a .gitignore of its own; else "proj" is new and "." is empty. */
  async function createInProj(ignores: Record<string, string>, mine: boolean, ...args: string[]) {
    const template = { "tpl.txt": "template", ...ignores };
    using github = await serveGithub(template);
    using dir = tempDir("create-gitignore", {
      "bun-create/tpl": template,
      ...(mine ? { "proj/.gitignore": "mine" } : dest === "." ? { "proj": {} } : {}),
    });
    const result = await create(
      join(String(dir), dest === "." ? "proj" : "."),
      [kind === "local" ? "tpl" : "dylan-conway/create-test", dest, "--no-git", ...args],
      { ...github.env, BUN_CREATE_DIR: join(String(dir), "bun-create") },
    );
    return { ...result, files: await tree(join(String(dir), "proj")) };
  }
  const dot = { ".gitignore": "dot" };
  const plain = { "gitignore": "plain" };

  const rows: [string, Record<string, string>, boolean, string[], string][] = [
    ["is the template's .gitignore, not its gitignore", { ...dot, ...plain }, false, [], "dot"],
    ["is the template's .gitignore, not its gitignore, with --force", { ...dot, ...plain }, false, ["--force"], "dot"],
    ["stays the destination's when the template has a gitignore", plain, true, [], "mine"],
    ["stays the destination's with --force when the template has neither", {}, true, ["--force"], "mine"],
    ["is replaced by the template's gitignore with --force", plain, true, ["--force"], "plain"],
    ["is replaced by the template's .gitignore with --force", dot, true, ["--force"], "dot"],
    [
      "is replaced by the template's .gitignore, not its gitignore, with --force",
      { ...dot, ...plain },
      true,
      ["--force"],
      "dot",
    ],
  ];
  it.each(rows)("%s", async (_, ignores, mine, args, expected) => {
    const { err, exitCode, files } = await createInProj(ignores, mine, ...args);

    expect(err).not.toContain("error");
    expect(files).toEqual({ ".gitignore": expected, "tpl.txt": "template" });
    expect(exitCode).toBe(0);
  });

  it("is in the way of the template's .gitignore", async () => {
    const { err, exitCode, files } = await createInProj(dot, true);

    expect(err.slice(err.indexOf("error:")).split("\n").filter(Boolean)).toEqual([
      "error: The directory proj/ contains files that could conflict:",
      "  .gitignore",
      "To overwrite them, use --force",
    ]);
    expect(files).toEqual({ ".gitignore": "mine" });
    expect(exitCode).toBe(1);
  });
});

// Both kinds of template were written through a link in the destination, to wherever it leads.
describe.concurrent.each(["local", "GitHub"])("a link in the destination of a %s template", kind => {
  const template = {
    "sub/nested.txt": "template",
    "file.txt": "template",
    "README.md": "template",
    "package.json": JSON.stringify({ name: "tpl" }),
  };
  const outside = { "file.txt": "outside", "README.md": "outside", "package.json": "outside" };
  const under = (prefix: string, files: Record<string, string>) =>
    Object.fromEntries(Object.entries(files).map(([path, text]) => [`${prefix}/${path}`, text]));

  const links = [
    ["sub", "."],
    ["file.txt", "file.txt"],
    // Nothing to overwrite behind it, and O_CREAT makes the file it names.
    ["file.txt", "missing.txt"],
    // As a file it is replaced without --force.
    ["README.md", "README.md"],
    ["package.json", "package.json"],
    // A link to a file needs a privilege on Windows, a junction does not.
  ].slice(0, isPosix ? undefined : 1);

  /** `bun create <template> . ...args` in `<root>/proj`, where `name` is a link to `<root>/outside/<target>`. */
  async function createOverLink(root: string, name: string, target: string, ...args: string[]) {
    symlinkSync(join(root, "outside", target), join(root, "proj", name), "junction");
    using github = await serveGithub(template);
    const result = await create(
      join(root, "proj"),
      [kind === "local" ? "tpl" : "dylan-conway/create-test", ".", "--no-git", "--no-install", ...args],
      { ...github.env, BUN_CREATE_DIR: join(root, "bun-create") },
    );
    return { ...result, isLink: lstatSync(join(root, "proj", name)).isSymbolicLink() };
  }
  const files = { ...under("bun-create/tpl", template), ...under("outside", outside), "proj/keep.txt": "mine" };

  it.each(links)("%s -> outside/%s is in the way", async (name, target) => {
    using dir = tempDir("create-over-link", files);
    const { err, exitCode, isLink } = await createOverLink(String(dir), name, target);

    // On Windows a local template's directories are copied as well as its files.
    const underSub = kind === "GitHub" ? ["  sub/"] : [...(isPosix ? [] : ["  sub"]), "  sub/nested.txt"];
    expect(err.slice(err.indexOf("error:")).replaceAll("\\", "/").split("\n").filter(Boolean)).toEqual([
      "error: The directory proj/ contains files that could conflict:",
      ...(name === "sub" ? underSub : [`  ${name}`]),
      "To overwrite them, use --force",
    ]);
    expect(await tree(join(String(dir), "outside"))).toEqual(outside);
    expect({ isLink, entries: readdirSync(join(String(dir), "proj")).sort() }).toEqual({
      isLink: true,
      entries: ["keep.txt", name].sort(),
    });
    expect(exitCode).toBe(1);
  });

  it.each(links)("--force replaces %s -> outside/%s", async (name, target) => {
    using dir = tempDir("create-over-link-force", files);
    const { err, exitCode, isLink } = await createOverLink(String(dir), name, target, "--force");

    expect(err).not.toContain("error");
    expect(await tree(join(String(dir), "outside"))).toEqual(outside);
    expect(isLink).toBe(false);
    expect(await tree(join(String(dir), "proj"))).toEqual({
      ...template,
      "keep.txt": "mine",
      "package.json": JSON.stringify({ name: "proj" }, null, 2) + "\n",
    });
    expect(exitCode).toBe(0);
  });
});

it.concurrent("should preserve package.json indentation from the template", async () => {
  using dir = tempDir("create-tabs", {
    "bun-create/tabs/package.json": `{\n\t"name": "tabs",\n\t"version": "1.0.0",\n\t"scripts": {\n\t\t"start": "bun index.js"\n\t}\n}\n`,
  });
  const { err, exitCode } = await create(String(dir), ["tabs", "dest", "--no-install", "--no-git"]);

  expect(err).not.toContain("error:");
  // `name` becomes the destination's, so the file is printed again.
  expect(await Bun.file(join(String(dir), "dest", "package.json")).text()).toBe(
    `{\n\t"name": "dest",\n\t"version": "1.0.0",\n\t"scripts": {\n\t\t"start": "bun index.js"\n\t}\n}\n`,
  );
  expect(exitCode).toBe(0);
});

// Windows copies from and to absolute paths, so a home directory like C:\Users\José is part of both.
it.concurrent.each([
  ["josé", "dest"],
  ["日本語", "dest"],
  ["ascii", "déstination"],
])("copies a local template when the working directory is %s and the destination is %s", async (cwd, destination) => {
  using dir = tempDir("create-non-ascii", {
    [`${cwd}/bun-create/tpl/package.json`]: JSON.stringify({ name: "tpl", version: "1.0.0" }),
    [`${cwd}/bun-create/tpl/src/index.js`]: "// index\n",
    [`${cwd}/bun-create/tpl/src/résumé.js`]: "// résumé\n",
  });
  const root = join(String(dir), cwd);
  const { err, exitCode } = await create(root, ["tpl", destination, "--no-install", "--no-git"]);

  expect(err).not.toContain("failed to copy file");
  const { "package.json": packageJson, ...files } = await tree(join(root, destination));
  expect(files).toEqual({ "src/index.js": "// index\n", "src/résumé.js": "// résumé\n" });
  expect(JSON.parse(packageJson)).toEqual({ name: destination, version: "1.0.0" });
  expect(exitCode).toBe(0);
});

it("should keep bun-create task and start strings containing escape sequences intact", async () => {
  const bunCreateDir = join(x_dir, "bun-create");
  const testTemplate = "escaped-config-template";

  await Bun.write(
    join(bunCreateDir, testTemplate, "package.json"),
    `{
  "name": "escaped-config-template",
  "version": "1.0.0",
  "bun-create": {
    "postinstall": "echo cr\\u00e9ate-step-done",
    "start": "bun run d\\u00e9v --hot"
  }
}
`,
  );
  await Bun.write(join(bunCreateDir, testTemplate, "index.js"), "console.log('hi');\n");

  await using proc = spawn({
    cmd: [bunExe(), "create", testTemplate, join(x_dir, "escaped-dest")],
    cwd: x_dir,
    stdout: "pipe",
    stdin: "ignore",
    stderr: "pipe",
    env: { ...env, BUN_CREATE_DIR: bunCreateDir, MIMALLOC_PURGE_DELAY: "0" },
  });

  const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(err).toContain("$ echo créate-step-done\n");
  expect(out).toContain("créate-step-done\n");
  expect(out).toContain("\n  cd escaped-dest\n  bun run dév --hot\n");
  expect(exitCode).toBe(0);
});

describe.concurrent("bun-create tasks", () => {
  const localdep = {
    dependencies: { localdep: "file:./localdep" },
  };
  const localdepFiles = {
    "localdep/package.json": JSON.stringify({
      name: "localdep",
      version: "1.0.0",
      bin: { "localdep-bin": "./bin.js" },
    }),
    "localdep/bin.js": `#!/usr/bin/env node\nrequire("fs").writeFileSync("BIN_RAN", "yes");\n`,
  };
  // On $PATH. `create-task` records its arguments in the directory it runs in.
  // The decoy `bun` comes first on $PATH, ahead of the real one.
  const stubs = {
    "bin/create-task": `#!/bin/sh\necho "$@" > TASK_RAN\n`,
    "bin/create-task.cmd": "@echo %*> TASK_RAN\r\n",
    "bin/bun": `#!/bin/sh\necho decoy > DECOY_RAN\n`,
    "bin/bun.cmd": "@echo decoy> DECOY_RAN\r\n",
  };

  /** Creates `dest` from a template with this package.json and these files; returns what is in `dest` afterwards. */
  async function createFrom(
    packageJson: object,
    files: Record<string, string> = {},
    args: string[] = ["--no-git"],
    /** Files in the directory that `bun create` runs in, and variables of its environment. */
    where: { files?: Record<string, string>; env?: Record<string, string> } = {},
  ) {
    using dir = tempDir("create-tasks", {
      ...stubs,
      ...where.files,
      "bun-create/tmpl/package.json": JSON.stringify({ name: "tmpl", version: "1.0.0", ...packageJson }),
      ...Object.fromEntries(Object.entries(files).map(([file, contents]) => [`bun-create/tmpl/${file}`, contents])),
    });
    const root = String(dir);
    for (const file of ["bin/create-task", "bin/bun", ...Object.keys(files).map(file => `bun-create/tmpl/${file}`)]) {
      chmodSync(join(root, file), 0o755);
    }
    const result = await create(root, ["tmpl", "dest", ...args], {
      PATH: join(root, "bin") + delimiter + process.env.PATH,
      ...gitIdentity,
      ...where.env,
    });
    const dest = join(root, "dest");
    const written = await tree(dest);
    for (const file of Object.keys(written)) {
      if (file in files || /^(node_modules|\.git)\/|^(package\.json|bun\.lock)$/.test(file)) delete written[file];
      else written[file] = written[file].trim();
    }
    const commits = args.includes("--no-git") ? "" : (await git(dest, "log", "--format=%s")).out;
    return { ...result, written, commits };
  }

  // Without dependencies the tasks were printed and never started, and `preinstall` not even printed.
  // With dependencies they were split on spaces and handed to `bun run`.
  it.each([
    ["no dependencies", {}, {}],
    ["dependencies", localdep, localdepFiles],
  ])("run through the shell: %s", async (_, dependencies, files) => {
    const { out, err, exitCode, written } = await createFrom(
      {
        ...dependencies,
        "bun-create": {
          preinstall: "echo 'Installing...' && echo $npm_lifecycle_event > PRE",
          postinstall: [
            "echo a    b > SPACES",
            "echo $npm_lifecycle_event of $npm_package_name > POST",
            "create-task first second",
          ],
        },
      },
      files,
    );

    expect(err).not.toContain("error:");
    expect(err).toContain("$ echo 'Installing...' && echo $npm_lifecycle_event > PRE\n");
    expect(err).toContain("$ create-task first second\n");
    expect(out).toContain("Installing...\n");
    expect(written).toEqual({
      PRE: "preinstall",
      SPACES: "a b",
      POST: "postinstall of dest",
      TASK_RAN: "first second",
    });
    expect(exitCode).toBe(0);
  });

  it("stop at the first task that fails, with its exit code", async () => {
    const { out, err, exitCode, written } = await createFrom({
      "bun-create": { postinstall: ["echo first > FIRST", "exit 3", "echo after > AFTER"] },
    });

    expect(err).toContain('error: script "postinstall" exited with code 3');
    expect(out).not.toContain("successfully");
    expect(written).toEqual({ FIRST: "first" });
    expect(exitCode).toBe(3);
  });

  it("a failing preinstall task stops before the install, after the commit", async () => {
    const { out, err, exitCode, written, commits } = await createFrom(
      { ...localdep, "bun-create": { preinstall: "exit 7", postinstall: "echo post > POST" } },
      localdepFiles,
      [],
    );

    expect(err).toContain('error: script "preinstall" exited with code 7');
    expect(out).not.toContain("$ bun install");
    expect(written).toEqual({});
    expect(commits).toBe("Initial commit (via bun create)");
    expect(exitCode).toBe(7);
  });

  it("are all skipped by --no-install", async () => {
    const { err, exitCode, written } = await createFrom(
      { "bun-create": { preinstall: "echo pre > PRE", postinstall: "echo post > POST" } },
      {},
      ["--no-git", "--no-install"],
    );

    expect(err).not.toContain("$ echo");
    expect(written).toEqual({});
    expect(exitCode).toBe(0);
  });

  it.each<[string, { args?: string[]; files?: Record<string, string>; env?: Record<string, string> }]>([
    ["--ignore-scripts", { args: ["--ignore-scripts"] }],
    ["ignoreScripts in bunfig.toml", { files: { "bunfig.toml": "[install]\nignoreScripts = true\n" } }],
    ["ignore-scripts in .npmrc", { files: { ".npmrc": "ignore-scripts=true\n" } }],
    ["NPM_CONFIG_IGNORE_SCRIPTS", { env: { NPM_CONFIG_IGNORE_SCRIPTS: "true" } }],
  ])("are all skipped by %s, with the scripts of the install", async (_, { args = [], ...where }) => {
    const { out, err, exitCode, written } = await createFrom(
      {
        ...localdep,
        scripts: { postinstall: "echo script > SCRIPT" },
        "bun-create": { preinstall: "echo pre > PRE", postinstall: "echo post > POST" },
      },
      localdepFiles,
      ["--no-git", ...args],
      where,
    );

    expect(err).not.toContain("$ echo");
    expect(out).toContain("$ bun install --ignore-scripts\n");
    expect(out).toContain("1 package installed");
    expect(written).toEqual({});
    expect(exitCode).toBe(0);
  });

  it("run a package.json script when the task is its name", async () => {
    const { err, exitCode, written } = await createFrom({
      scripts: { setup: "echo setup-ran > SETUP" },
      "bun-create": { postinstall: "setup" },
    });

    expect(err).toContain("$ bun run setup\n");
    expect(written).toEqual({ SETUP: "setup-ran" });
    expect(exitCode).toBe(0);
  });

  it.each([
    ["no dependencies", {}, {}],
    ["dependencies", localdep, localdepFiles],
  ])("run `bun ...` with the bun that runs `bun create`: %s", async (_, dependencies, files) => {
    const { err, exitCode, written } = await createFrom(
      { ...dependencies, "bun-create": { preinstall: "bun marker.ts PRE", postinstall: "bun marker.ts POST" } },
      {
        ...files,
        "marker.ts": `const { dev, ino } = require("fs").statSync(process.execPath, { bigint: true });\nawait Bun.write(process.argv[2], dev + ":" + ino);`,
        // Not this one either: a bare command is not looked up in the destination.
        ...(isPosix ? { "bun": stubs["bin/bun"] } : {}),
      },
    );

    expect(err).not.toContain("error:");
    // The task's `bun` is a link to the running executable: a symlink, or a hard link on Windows.
    const { dev, ino } = statSync(bunExe(), { bigint: true });
    expect(written).toEqual({ PRE: `${dev}:${ino}`, POST: `${dev}:${ino}` });
    expect(exitCode).toBe(0);
  });

  it("find the bins of the installed dependencies", async () => {
    const { err, exitCode, written } = await createFrom(
      { ...localdep, "bun-create": { postinstall: "localdep-bin" } },
      localdepFiles,
    );

    expect(err).not.toContain("error:");
    expect(written).toEqual({ BIN_RAN: "yes" });
    expect(exitCode).toBe(0);
  });

  it.skipIf(!isPosix)("do not look for a bare command in the destination", async () => {
    const { exitCode, written } = await createFrom(
      { "bun-create": { postinstall: "local-task first" } },
      { "local-task": stubs["bin/create-task"] },
    );

    expect(written).toEqual({});
    expect(exitCode).toBe(127);
  });

  // The script needs its shebang to be started, so POSIX only.
  it.skipIf(!isPosix)("run a path relative to the destination", async () => {
    const { err, exitCode, written } = await createFrom(
      { "bun-create": { postinstall: "./setup.sh first second" } },
      { "setup.sh": stubs["bin/create-task"] },
    );

    expect(err).not.toContain("error:");
    expect(written).toEqual({ TASK_RAN: "first second" });
    expect(exitCode).toBe(0);
  });
});

it("should not crash with --no-install and bun-create.postinstall starting with 'bun '", async () => {
  const bunCreateDir = join(x_dir, "bun-create");
  const testTemplate = "postinstall-test";

  await Bun.write(
    join(bunCreateDir, testTemplate, "package.json"),
    JSON.stringify({
      name: "test",
      "bun-create": {
        postinstall: "bun install",
      },
    }),
  );

  const { exited, stderr, stdout } = spawn({
    cmd: [bunExe(), "create", testTemplate, join(x_dir, "dest"), "--no-install"],
    cwd: x_dir,
    stdout: "pipe",
    stdin: "ignore",
    stderr: "pipe",
    env: { ...env, BUN_CREATE_DIR: bunCreateDir },
  });

  const [err, _out, exitCode] = await Promise.all([stderr.text(), stdout.text(), exited]);
  expect(err).not.toContain("error:");
  expect(exitCode).toBe(0);
});

describe.each([
  ["ESC [ 2 K", "\x1b[2K", "\\x1b[2K"],
  ["CR", "\r", "\\r"],
  ["BEL", "\x07", "\\x07"],
  ["U+009B", "\u009b2K", "\\u009b2K"],
  ["OSC 52", "\x1b]52;c;aGk=\x07", "\\x1b]52;c;aGk=\\x07"],
])("%s in a template is printed spelled out", (_, raw, spelled) => {
  const unprintable = /[\x00-\x09\x0b-\x1f\x7f-\x9f]/;

  it("in the command to start with", async () => {
    using dir = tempDir("create-start", {
      "bun-create/tpl/package.json": JSON.stringify({ name: "tpl", "bun-create": { start: `bun run a${raw}b` } }),
    });
    const { out, err, exitCode } = await create(String(dir), ["tpl", "dest", "--no-install", "--no-git"]);
    expect(out).toContain(`\n  cd dest\n  bun run a${spelled}b\n`);
    expect(out + err).not.toMatch(unprintable);
    expect(exitCode).toBe(0);
  });

  it.skipIf(!isPosix)("in the name of a file that is in the way", async () => {
    using dir = tempDir("create-conflict", {
      "bun-create/tpl/package.json": JSON.stringify({ name: "tpl" }),
      [`bun-create/tpl/a${raw}b.js`]: "template",
      [`dest/a${raw}b.js`]: "mine",
    });
    const { out, err, exitCode } = await create(String(dir), ["tpl", "dest", "--no-install", "--no-git"]);
    expect(err).toContain(`\n  a${spelled}b.js\n`);
    expect(out + err).not.toMatch(unprintable);
    expect(exitCode).toBe(1);
  });
});
