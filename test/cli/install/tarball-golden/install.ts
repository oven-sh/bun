// Installs many tarballs at once with `bun install` and says what became of each.
import { bunEnv, tempDir } from "harness";
import { createServer } from "node:http";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tree } from "../../../js/bun/archive-golden/observe";

export type Case = {
  /** What follows `package/package.json` in the tarball, base64. */
  data: string;
  /** Whether macOS and Windows read it the way Linux does. */
  mac: boolean;
  win: boolean;
  /** The installed package, or null if the tarball is refused. */
  tree: string | null;
};

function header(name: string, size: number) {
  const h = Buffer.alloc(512);
  h.write(name, 0);
  h.write("0000644\0", 100);
  h.write("0000000\0", 108);
  h.write("0000000\0", 116);
  h.write(size.toString(8).padStart(11, "0") + "\0", 124);
  h.write("00000000000\0", 136);
  h.fill(" ", 148, 156);
  h.write("0", 156);
  h.write("ustar\0" + "00", 257);
  h.write(
    h
      .reduce((a, b) => a + b, 0)
      .toString(8)
      .padStart(6, "0") + "\0 ",
    148,
  );
  return h;
}

function tarball(name: string, rest: Buffer) {
  const json = Buffer.from(JSON.stringify({ name, version: "1.0.0" }));
  const padding = Buffer.alloc((512 - (json.length % 512)) % 512);
  return Buffer.from(Bun.gzipSync(Buffer.concat([header("package/package.json", json.length), json, padding, rest])));
}

/**
 * `streaming` is whether tarballs are extracted while they download. They are sent in pieces, since
 * one that arrives whole is extracted from memory either way.
 */
export async function install(exe: string, cases: { id: number; data: string }[], streaming: boolean) {
  const tarballs = new Map(cases.map(c => [`/c${c.id}.tgz`, tarball(`c${c.id}`, Buffer.from(c.data, "base64"))]));
  const server = createServer((req, res) => {
    const body = tarballs.get(req.url!)!;
    res.writeHead(200, { "content-length": body.length, "content-type": "application/octet-stream" });
    const step = Math.ceil(body.length / 4);
    let at = 0;
    (function send() {
      if (at >= body.length) return void res.end();
      res.write(body.subarray(at, (at += step)), () => setImmediate(send));
    })();
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  using _ = { [Symbol.dispose]: () => void server.close() };
  const { port } = server.address() as import("node:net").AddressInfo;

  using dir = tempDir("tarball-golden", {
    "package.json": JSON.stringify({
      name: "root",
      dependencies: Object.fromEntries(cases.map(c => [`c${c.id}`, `http://127.0.0.1:${port}/c${c.id}.tgz`])),
    }),
  });
  await using proc = Bun.spawn({
    cmd: [exe, "install", "--ignore-scripts"],
    cwd: String(dir),
    env: {
      ...bunEnv,
      BUN_INSTALL_CACHE_DIR: join(String(dir), ".cache"),
      ...(streaming
        ? { BUN_INSTALL_STREAMING_MIN_SIZE: "0", BUN_INSTALL_STREAMING_DRAIN_THRESHOLD: "1" }
        : { BUN_FEATURE_FLAG_DISABLE_STREAMING_INSTALL: "1" }),
    },
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  const refused = new Set(
    Array.from(stderr.matchAll(/extracting tarball (?:for|from) "?c(\d+)\b/g), m => Number(m[1])),
  );
  const trees = new Map<number, string | null>();
  for (const { id } of cases) {
    const path = join(String(dir), "node_modules", `c${id}`);
    const lines: string[] = [];
    if (existsSync(path)) tree(Buffer.from(path), Buffer.alloc(0), lines);
    // `.bun-tag` holds a hash of the compressed tarball, which depends on the compressor. How many
    // links a file has depends on how the platform copies it out of the cache.
    const shown = lines.filter(line => !line.startsWith('file "/.bun-tag"')).join("\n");
    trees.set(id, refused.has(id) ? null : shown.replace(/ nlink=\d+/g, "") + "\n");
  }
  return { trees, exitCode, stderr };
}
