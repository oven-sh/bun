import { spawn, spawnSync } from "bun";
import { beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, mkdirSync, writeFileSync } from "fs";
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

// The exit status of the nested `bun install` used to be dropped: when it
// failed, `bun create` still printed "dependencies were installed
// automatically" / "Created ... successfully" and exited 0.
//
// Ways to make that install fail, and what `bun create` must then exit with: a
// dependency the registry (a local server answering 404) cannot provide makes
// `bun install` exit 1; a failing root postinstall script makes it exit with
// the script's own code; a root postinstall script killed by a signal makes
// `bun install` re-raise that signal on itself, which is reported the way
// shells do, as 128 + the signal number.
const installFailures = [
  {
    name: "an unresolvable dependency",
    packageJson: { dependencies: { "bun-create-missing-dep": "1.0.0" } },
    exitCode: 1,
  },
  {
    name: "a failing postinstall script",
    packageJson: { dependencies: { localdep: "file:./localdep" }, scripts: { postinstall: "exit 3" } },
    exitCode: 3,
  },
  ...(isPosix
    ? [
        {
          name: "a postinstall script killed by SIGKILL",
          packageJson: {
            dependencies: { localdep: "file:./localdep" },
            scripts: { postinstall: "sh -c 'kill -9 $$'" },
          },
          exitCode: 128 + 9,
        },
      ]
    : []),
];

// Runs `bun create` on a local template whose install fails as described by
// `failure`, checks everything the failure must and must not produce, and
// returns bun create's stderr. `onStderr` is called with everything written to
// stderr so far each time more of it arrives.
async function createWithFailingInstall(
  failure: (typeof installFailures)[number],
  {
    args = [],
    extraEnv = {},
    onStderr,
  }: {
    args?: string[];
    extraEnv?: Record<string, string>;
    onStderr?: (stderrSoFar: string) => void;
  } = {},
) {
  using registry = Bun.serve({
    port: 0,
    fetch: () => new Response("not found", { status: 404 }),
  });
  using dir = tempDir("create-install-fails", {
    "bun-create/tmpl/index.js": "// hi\n",
    "bun-create/tmpl/localdep/package.json": JSON.stringify({ name: "localdep", version: "1.0.0" }),
    "bun-create/tmpl/package.json": JSON.stringify({
      name: "tmpl",
      version: "1.0.0",
      ...failure.packageJson,
      "bun-create": { postinstall: "echo postinstall-task-ran" },
    }),
  });
  const dest = join(String(dir), "dest");

  await using proc = spawn({
    cmd: [bunExe(), "create", "tmpl", dest, ...args],
    cwd: String(dir),
    stdout: "pipe",
    stdin: "ignore",
    stderr: "pipe",
    env: {
      ...env,
      ...extraEnv,
      BUN_CREATE_DIR: join(String(dir), "bun-create"),
      BUN_CONFIG_REGISTRY: String(registry.url),
      BUN_INSTALL_CACHE_DIR: join(String(dir), ".bun-cache"),
    },
  });
  const readStderr = async () => {
    const decoder = new TextDecoder();
    let text = "";
    for await (const chunk of proc.stderr) {
      text += decoder.decode(chunk, { stream: true });
      onStderr?.(text);
    }
    return text + decoder.decode();
  };
  const [out, err, exitCode] = await Promise.all([proc.stdout.text(), readStderr(), proc.exited]);

  // The template files were copied before the install ran and stay on disk.
  expect(await exists(join(dest, "index.js"))).toBe(true);
  expect(err).toMatch(new RegExp(`error: bun install failed in "[^"]*dest" \\(code: ${failure.exitCode}\\)`));
  expect(err).toContain(
    "note: the template files were written; run bun install in that directory once the error is fixed",
  );
  expect(out).toContain("$ bun install");
  // The template's own `bun-create` tasks still run (they are not written to
  // the project, so this is the only chance to see them); the banner does not.
  expect(out).toContain("postinstall-task-ran");
  expect(out).not.toContain("installed automatically");
  expect(out).not.toContain("successfully");
  expect(out).not.toContain("To get started");
  expect(proc.signalCode).toBeNull();
  expect(exitCode).toBe(failure.exitCode);
  return err;
}

it.each(installFailures)(
  "reports the failure and exits with the install's code when the nested `bun install` fails because of $name",
  async failure => {
    await createWithFailingInstall(failure, { args: ["--no-git"] });
  },
);

// Without --no-git the git commands run on a second thread while the install
// runs, and the thread prints its "[..ms] git" line once they are all done. A
// failed install must still wait for that thread rather than exit while git is
// writing the repository. The stub git blocks until the test releases it, and
// the test only does that after bun create has printed the "[..ms] bun install"
// line, i.e. after the install's failure is known: "] git" can then only show up
// in stderr if bun create waited. POSIX-only: the stub is a shell script.
it.skipIf(!isPosix)("still waits for the git thread when the nested `bun install` fails", async () => {
  using bin = tempDir("create-install-fails-git", {});
  const release = join(String(bin), "release");
  writeFileSync(
    join(String(bin), "git"),
    `#!/bin/sh
# Blocks until the test creates the release file; gives up after ~5s so a
# broken run cannot leave it spinning forever.
i=0
while [ ! -e "${release}" ] && [ $i -lt 500 ]; do
  sleep 0.01
  i=$((i + 1))
done
exit 0
`,
    { mode: 0o755 },
  );

  let stderrAtRelease: string | undefined;
  const err = await createWithFailingInstall(installFailures[0], {
    extraEnv: { PATH: `${bin}:${env.PATH}` },
    onStderr(stderrSoFar) {
      if (stderrAtRelease === undefined && stderrSoFar.includes("] bun install")) {
        stderrAtRelease = stderrSoFar;
        writeFileSync(release, "");
      }
    },
  });

  // Neither the git timing line nor bun create's own error had been printed
  // while git was still blocked; both were once git had been released.
  expect(stderrAtRelease).toBeDefined();
  expect(stderrAtRelease).not.toContain("] git");
  expect(stderrAtRelease).not.toContain("error: bun install failed");
  expect(err).toContain("] git");
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

  const [out, _err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(out).toContain("\n$ echo créate-step-done\n");
  expect(out).toContain("\n  cd escaped-dest\n  bun run dév --hot\n");
  expect(exitCode).toBe(0);
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
