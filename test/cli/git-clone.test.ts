// End-to-end test for `bun git-clone` over real smart-HTTP. A bare repo is
// served by `git http-backend` (the same CGI GitHub fronts) behind a tiny
// Bun.serve proxy, so the HTTP transport, pkt-line framing, side-band demux,
// pack indexing, and checkout are all exercised against bytes a real git
// server produced — without touching the network.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const httpBackend = ["/usr/libexec/git-core/git-http-backend", "/usr/lib/git-core/git-http-backend"].find(existsSync);

function git(cwd: string, args: string[]) {
  const r = spawnSync("git", args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
      GIT_CONFIG_NOSYSTEM: "1",
    },
  });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed:\n${r.stdout}\n${r.stderr}`);
  }
  return r.stdout.toString();
}

test.skipIf(!httpBackend)("bun git-clone over smart-HTTP", async () => {
  using dir = tempDir("git-clone", {
    "src/README.md": "hello world\n",
    "src/dir/a.txt": "alpha\n",
  });
  const root = String(dir);
  const src = `${root}/src`;

  // Build a repo with enough history that upload-pack emits OFS_DELTA entries.
  git(src, ["init", "-q", "-b", "main"]);
  let big = Buffer.alloc(16384);
  for (let i = 0; i < big.length; i++) big[i] = i % 251;
  await Bun.write(`${src}/dir/b.bin`, big);
  git(src, ["add", "-A"]);
  git(src, ["commit", "-qm", "one"]);
  for (let i = 0; i < 5; i++) {
    big.set(Buffer.from("zzzzzzzzzzzzzzzz"), 1000 + i * 200);
    await Bun.write(`${src}/dir/b.bin`, big);
    await Bun.write(`${src}/README.md`, `hello world\nv${i + 2}\n`);
    git(src, ["commit", "-aqm", `c${i}`]);
  }
  git(root, ["clone", "-q", "--bare", "src", "src.git"]);
  git(`${root}/src.git`, ["repack", "-adq", "--depth=50", "--window=50"]);
  // Required for http-backend to serve `git-upload-pack`.
  git(`${root}/src.git`, ["config", "http.uploadpack", "true"]);

  // Serve the bare repo over smart-HTTP via the git CGI.
  using server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const body = req.body ? Buffer.from(await req.arrayBuffer()) : Buffer.alloc(0);
      const proc = Bun.spawn({
        cmd: [httpBackend!],
        env: {
          GIT_PROJECT_ROOT: root,
          GIT_HTTP_EXPORT_ALL: "1",
          PATH_INFO: url.pathname,
          REQUEST_METHOD: req.method,
          QUERY_STRING: url.search.slice(1),
          CONTENT_TYPE: req.headers.get("content-type") ?? "",
          CONTENT_LENGTH: String(body.length),
          GIT_PROTOCOL: req.headers.get("git-protocol") ?? "",
          REMOTE_ADDR: "127.0.0.1",
          SERVER_PROTOCOL: "HTTP/1.1",
        },
        stdin: body,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [out, err, code] = await Promise.all([
        new Response(proc.stdout).arrayBuffer(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      if (code !== 0) return new Response(`http-backend failed: ${err}`, { status: 500 });
      // CGI: split headers from body at first CRLFCRLF.
      const buf = Buffer.from(out);
      const sep = buf.indexOf("\r\n\r\n");
      const hdrs: Record<string, string> = {};
      for (const line of buf.subarray(0, sep).toString().split("\r\n")) {
        const i = line.indexOf(": ");
        if (i > 0) hdrs[line.slice(0, i)] = line.slice(i + 2);
      }
      const status = hdrs["Status"] ? parseInt(hdrs["Status"]) : 200;
      delete hdrs["Status"];
      return new Response(buf.subarray(sep + 4), { status, headers: hdrs });
    },
  });

  const dest = `${root}/out`;
  await using proc = Bun.spawn({
    // -j1: single-connection path (the local http-backend doesn't enable
    // uploadpack.allowFilter, so the parallel filter=blob:none path can't be
    // exercised here — that's covered by the GitHub-compatibility contract).
    cmd: [bunExe(), "git-clone", `http://127.0.0.1:${server.port}/src.git`, dest, "-q", "-j1"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Worktree must match the source HEAD.
  expect(readFileSync(`${dest}/README.md`, "utf8")).toBe("hello world\nv6\n");
  expect(readFileSync(`${dest}/dir/a.txt`, "utf8")).toBe("alpha\n");
  expect(Buffer.compare(readFileSync(`${dest}/dir/b.bin`), big)).toBe(0);
  expect(readFileSync(`${dest}/.git/HEAD`, "utf8")).toBe("ref: refs/heads/main\n");

  // System git must consider the resulting .git valid and complete.
  const fsck = spawnSync("git", ["-C", dest, "fsck", "--full", "--strict"]);
  expect({
    fsck_stdout: fsck.stdout.toString(),
    fsck_stderr: fsck.stderr.toString(),
    fsck_status: fsck.status,
  }).toEqual({ fsck_stdout: "", fsck_stderr: "", fsck_status: 0 });

  // The .idx must match what `git index-pack` produces — proves every object
  // SHA, CRC, offset, and the fanout table are byte-correct.
  const packDir = `${dest}/.git/objects/pack`;
  const pack = (await Array.fromAsync(new Bun.Glob("*.pack").scan({ cwd: packDir }))).map(f => `${packDir}/${f}`)[0];
  const altIdx = `${root}/alt.idx`;
  const ip = spawnSync("git", ["index-pack", "-o", altIdx, pack]);
  expect(ip.status).toBe(0);
  expect(Buffer.compare(readFileSync(pack.replace(/\.pack$/, ".idx")), readFileSync(altIdx))).toBe(0);

  expect(normalizeBunSnapshot(stdout, dir)).toMatchInlineSnapshot(`""`);
  expect(stderr).not.toContain("error");
  expect(exitCode).toBe(0);
});

test("bun git-clone rejects unknown scheme", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "git-clone", "ftp://example.com/x.git", "/tmp/never"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toContain("unsupported URL scheme");
  expect(stdout).toBe("");
  expect(exitCode).toBe(1);
});
