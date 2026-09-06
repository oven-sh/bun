import { spawn, spawnSync } from "bun";
import { beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, mkdirSync, realpathSync } from "fs";
import { exists, stat } from "fs/promises";
import { bunExe, bunEnv as env, isPosix, tempDir, tls, tmpdirSync } from "harness";
import { once } from "node:events";
import * as nodetls from "node:tls";
import { join } from "path";
import { gzipSync } from "zlib";

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

it("should create selected template with @ prefix", async () => {
  const { stderr, exited } = spawn({
    cmd: [bunExe(), "create", "@quick-start/some-template"],
    cwd: x_dir,
    stdout: "inherit",
    stdin: "inherit",
    stderr: "pipe",
    env,
  });

  await exited;

  const err = await stderr.text();
  expect(err.split(/\r?\n/)).toContain(
    `error: GET https://registry.npmjs.org/@quick-start%2fcreate-some-template - 404`,
  );
});

it("should create selected template with @ prefix implicit `/create`", async () => {
  const { stderr, exited } = spawn({
    cmd: [bunExe(), "create", "@second-quick-start"],
    cwd: x_dir,
    stdout: "inherit",
    stdin: "inherit",
    stderr: "pipe",
    env,
  });

  const err = await stderr.text();
  expect(err.split(/\r?\n/)).toContain(`error: GET https://registry.npmjs.org/@second-quick-start%2fcreate - 404`);
  await exited;
});

it("should create selected template with @ prefix implicit `/create` with version", async () => {
  const { stderr, exited } = spawn({
    cmd: [bunExe(), "create", "@second-quick-start"],
    cwd: x_dir,
    stdout: "inherit",
    stdin: "inherit",
    stderr: "pipe",
    env,
  });

  const err = await stderr.text();
  expect(err.split(/\r?\n/)).toContain(`error: GET https://registry.npmjs.org/@second-quick-start%2fcreate - 404`);

  await exited;
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

it("keeps tarball entry paths within the destination when checking for conflicting files", async () => {
  const tarEntry = (name: string, body: Buffer) => {
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
  };
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

// GitHandler::wait() used Futex::wait(.., Some(1000)) (1us timeout) in a loop,
// issuing ~18k futex syscalls/sec while the git thread ran. POSIX-only: stub
// `git` is a shell script and ru_nvcsw is always 0 on Windows.
it.skipIf(!isPosix)("does not busy-wait on the futex while git runs", async () => {
  using dir = tempDir("create-git-futex", {
    "bin/git": "#!/bin/sh\nsleep 0.5\nexit 0\n",
    "bun-create/tmpl/index.js": "// hi\n",
    "bun-create/tmpl/package.json": JSON.stringify({
      name: "tmpl",
      version: "1.0.0",
      dependencies: { localdep: "file:./localdep" },
    }),
    "bun-create/tmpl/localdep/package.json": JSON.stringify({ name: "localdep", version: "1.0.0" }),
  });
  chmodSync(join(String(dir), "bin", "git"), 0o755);

  const proc = spawnSync({
    cmd: [bunExe(), "create", "tmpl", join(String(dir), "dest")],
    cwd: String(dir),
    env: {
      ...env,
      PATH: join(String(dir), "bin") + ":" + process.env.PATH,
      BUN_CREATE_DIR: join(String(dir), "bun-create"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const stderr = proc.stderr.toString();
  expect(stderr).not.toContain("error:");
  expect(stderr).toContain("] git");
  expect(proc.exitCode).toBe(0);
  // Before the fix this was ~27,000 over the ~1.5s git wait; after, a few dozen.
  expect(proc.resourceUsage!.contextSwitches.voluntary).toBeLessThan(2000);
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

// `bun create <github-url>` hits https://api.github.com/repos/{owner}/{repo}/tarball.
// CI exhausts the unauthenticated 60 req/hr limit (403) and the endpoint serves 5xx
// during outages; skip rather than fail since these tests exercise `bun create`, not GitHub.
function githubUnavailableReason(stderr: string): string | null {
  if (stderr.includes("GitHub is rate limiting"))
    return "GitHub API rate limit reached. Set GITHUB_TOKEN to avoid this.";
  if (stderr.includes("GitHub returned a server error")) return "GitHub API returned a 5xx server error.";
  return null;
}
function isGithubUnavailable(stderr: string): boolean {
  const reason = githubUnavailableReason(stderr);
  if (reason) console.warn(`Skipping: ${reason}`);
  return reason !== null;
}

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
    expect(githubUnavailableReason(err)).not.toBeNull();
    expect(err).not.toContain("NPMIsDown");
    expect(err).not.toContain("An internal error occurred");
    expect(exitCode).toBe(1);
  });
}

it("should not mention cd prompt when created in current directory", async () => {
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "create", "https://github.com/dylan-conway/create-test", "."],
    cwd: x_dir,
    stdout: "pipe",
    stdin: "inherit",
    stderr: "pipe",
    env,
  });

  const [out, err] = await Promise.all([stdout.text(), stderr.text(), exited]);
  if (isGithubUnavailable(err)) return;

  expect(err).not.toContain("error:");
  expect(out).toContain("bun dev");
  expect(out).not.toContain("\n\n  cd \n  bun dev\n\n");
}, 20_000);

for (const repo of ["https://github.com/dylan-conway/create-test", "github.com/dylan-conway/create-test"]) {
  it(`should create and install github template from ${repo}`, async () => {
    const { stderr, stdout, exited } = spawn({
      cmd: [bunExe(), "create", repo],
      cwd: x_dir,
      stdout: "pipe",
      stderr: "pipe",
      env,
    });

    const [out, err, exitCode] = await Promise.all([stdout.text(), stderr.text(), exited]);
    if (isGithubUnavailable(err)) return;
    expect(err).not.toContain("error:");
    expect(out).toContain("Success! dylan-conway/create-test loaded into create-test");
    expect(await exists(join(x_dir, "create-test", "node_modules", "jquery"))).toBe(true);

    expect(exitCode).toBe(0);
  }, 20_000);
}

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

describe("bun-create hooks", () => {
  function writeTemplate(name: string, pkg: Record<string, unknown>) {
    const bunCreateDir = join(x_dir, "bun-create");
    return Promise.all([
      Bun.write(join(bunCreateDir, name, "package.json"), JSON.stringify({ name, version: "1.0.0", ...pkg })),
      Bun.write(join(bunCreateDir, name, "index.js"), "console.log('hi');\n"),
    ]).then(() => bunCreateDir);
  }

  async function runCreate(template: string, dest: string, bunCreateDir: string, extraArgs: string[] = []) {
    await using proc = spawn({
      cmd: [bunExe(), "create", template, dest, "--no-git", ...extraArgs],
      cwd: x_dir,
      stdout: "pipe",
      stdin: "ignore",
      stderr: "pipe",
      env: { ...env, BUN_CREATE_DIR: bunCreateDir },
    });
    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { out, err, exitCode };
  }

  it.skipIf(!isPosix)("run through the shell when the template has no dependencies", async () => {
    const bunCreateDir = await writeTemplate("hooks-no-deps", {
      dependencies: {},
      "bun-create": {
        preinstall: "echo 'Installing...' && echo pre > PRE_RAN",
        postinstall: ["echo a    b >> hooks.log", "echo done && echo chained > CHAINED", 'sh -c "echo hi > f.txt"'],
      },
    });
    const dest = join(x_dir, "hooks-no-deps-dest");

    const { out, err, exitCode } = await runCreate("hooks-no-deps", dest, bunCreateDir);
    expect(out).toContain("Installing...\n");
    expect(err).toContain("$ echo 'Installing...' && echo pre > PRE_RAN\n");
    expect(exitCode).toBe(0);

    expect(await Bun.file(join(dest, "PRE_RAN")).text()).toBe("pre\n");
    expect(await Bun.file(join(dest, "hooks.log")).text()).toBe("a b\n");
    expect(await Bun.file(join(dest, "CHAINED")).text()).toBe("chained\n");
    expect(await Bun.file(join(dest, "f.txt")).text()).toBe("hi\n");
  });

  it.skipIf(!isPosix)("stop with the hook's exit code when a hook fails", async () => {
    const bunCreateDir = await writeTemplate("hooks-fail", {
      "bun-create": {
        postinstall: ["echo first > FIRST", "exit 3", "echo after > AFTER"],
      },
    });
    const dest = join(x_dir, "hooks-fail-dest");

    const { err, exitCode } = await runCreate("hooks-fail", dest, bunCreateDir);
    expect(err).toContain('script "postinstall" exited with code 3');
    expect(exitCode).toBe(3);

    expect(await exists(join(dest, "FIRST"))).toBe(true);
    expect(await exists(join(dest, "AFTER"))).toBe(false);
  });

  it.skipIf(!isPosix)("set npm_lifecycle_event and npm_package_name for the hook", async () => {
    const bunCreateDir = await writeTemplate("hooks-env", {
      "bun-create": {
        preinstall: "echo $npm_lifecycle_event/$npm_package_name > PRE_ENV",
        postinstall: "echo $npm_lifecycle_event/$npm_package_name > POST_ENV",
      },
    });
    const dest = join(x_dir, "hooks-env-dest");

    const { exitCode } = await runCreate("hooks-env", dest, bunCreateDir);
    expect(exitCode).toBe(0);
    expect(await Bun.file(join(dest, "PRE_ENV")).text()).toBe("preinstall/hooks-env-dest\n");
    expect(await Bun.file(join(dest, "POST_ENV")).text()).toBe("postinstall/hooks-env-dest\n");
  });

  it("skip every hook with --no-install", async () => {
    const bunCreateDir = await writeTemplate("hooks-skip", {
      "bun-create": {
        preinstall: "echo pre > PRE_RAN",
        postinstall: "echo post > POST_RAN",
      },
    });
    const dest = join(x_dir, "hooks-skip-dest");

    const { err, exitCode } = await runCreate("hooks-skip", dest, bunCreateDir, ["--no-install"]);
    expect(err).not.toContain("$ echo");
    expect(exitCode).toBe(0);
    expect(await exists(join(dest, "PRE_RAN"))).toBe(false);
    expect(await exists(join(dest, "POST_RAN"))).toBe(false);
  });

  it.skipIf(!isPosix)("run a bare package.json script name through bun run", async () => {
    const bunCreateDir = await writeTemplate("hooks-script-name", {
      scripts: { setup: "echo setup-ran > SETUP" },
      "bun-create": { postinstall: "setup" },
    });
    const dest = join(x_dir, "hooks-script-name-dest");

    const { err, exitCode } = await runCreate("hooks-script-name", dest, bunCreateDir);
    expect(err).toContain("$ bun run setup\n");
    expect(exitCode).toBe(0);
    expect(await Bun.file(join(dest, "SETUP")).text()).toBe("setup-ran\n");
  });

  it.skipIf(!isPosix)("resolve a bun task to the running bun, not a file in the template", async () => {
    const bunCreateDir = await writeTemplate("hooks-bun-task", {
      "bun-create": {
        postinstall: ["bun --version", "bun -e \"require('fs').writeFileSync('EXEC', process.execPath)\""],
      },
    });
    await Bun.write(join(bunCreateDir, "hooks-bun-task", "bun"), "#!/bin/sh\necho TEMPLATE-BUN-RAN\n");
    chmodSync(join(bunCreateDir, "hooks-bun-task", "bun"), 0o755);
    const dest = join(x_dir, "hooks-bun-task-dest");

    const { out, exitCode } = await runCreate("hooks-bun-task", dest, bunCreateDir);
    expect(out).not.toContain("TEMPLATE-BUN-RAN");
    expect(exitCode).toBe(0);
    expect(realpathSync(await Bun.file(join(dest, "EXEC")).text())).toBe(realpathSync(bunExe()));
  });

  it.skipIf(!isPosix)("commit the template before a hook can fail", async () => {
    // With a dependency, git runs on its own thread next to bun install.
    // The failing hook must not end the process while that thread writes.
    const bunCreateDir = await writeTemplate("hooks-git-first", {
      dependencies: { "is-number": "7.0.0" },
      "bun-create": { preinstall: "exit 7" },
    });
    const dest = join(x_dir, "hooks-git-first-dest");

    await using proc = spawn({
      cmd: [bunExe(), "create", "hooks-git-first", dest],
      cwd: x_dir,
      stdout: "pipe",
      stdin: "ignore",
      stderr: "pipe",
      env: {
        ...env,
        BUN_CREATE_DIR: bunCreateDir,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@t.t",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@t.t",
      },
    });
    const [, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(err).toContain('script "preinstall" exited with code 7');
    expect(exitCode).toBe(7);

    await using git = spawn({ cmd: ["git", "log", "--oneline"], cwd: dest, stdout: "pipe", stderr: "pipe" });
    expect(await git.stdout.text()).toContain("Initial commit");
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
