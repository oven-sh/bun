// https://github.com/oven-sh/bun/issues/29087
//
// `bun create <template> -- <args>` should strip a single leading `--` before
// forwarding to the create script (npm/yarn convention), and must not leak
// flags the `bun create` wrapper itself consumed (`--bun`).
//
// Before the fix:
//   $ bun create foo -- -t v3
//   process.argv.slice(2) === ["--", "-t", "v3"]
// After:
//   process.argv.slice(2) === ["-t", "v3"]

import type { Server } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

/** Minimal gzipped tar of a single-binary npm package. */
function createTarball(name: string, version: string, binName: string, script: string): Uint8Array {
  const packageJson = JSON.stringify({
    name,
    version,
    bin: { [binName]: "index.js" },
  });

  const files: Record<string, string> = {
    "package/package.json": packageJson,
    "package/index.js": script,
  };

  const entries: Buffer[] = [];
  let tarSize = 0;

  for (const [path, content] of Object.entries(files)) {
    const contentBuf = Buffer.from(content, "utf8");
    const blockSize = Math.ceil((contentBuf.length + 512) / 512) * 512;
    const entry = Buffer.alloc(blockSize);

    entry.write(path, 0, Math.min(path.length, 99));
    entry.write("0000755", 100, 7); // mode (executable -- bin needs +x)
    entry.write("0000000", 108, 7); // uid
    entry.write("0000000", 116, 7); // gid
    entry.write(contentBuf.length.toString(8).padStart(11, "0"), 124, 11); // size
    entry.write("00000000000", 136, 11); // mtime
    entry.write("        ", 148, 8); // checksum placeholder (8 spaces)
    entry.write("0", 156, 1); // type flag: regular file

    // tar checksum = sum of header bytes, with checksum field treated as spaces.
    let checksum = 0;
    for (let i = 0; i < 512; i++) {
      checksum += i >= 148 && i < 156 ? 32 : entry[i];
    }
    entry.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, 8);

    contentBuf.copy(entry, 512);
    entries.push(entry);
    tarSize += blockSize;
  }

  // Two 512-byte zero blocks = end-of-archive.
  entries.push(Buffer.alloc(1024));
  tarSize += 1024;

  return Bun.gzipSync(Buffer.concat(entries, tarSize));
}

describe.concurrent("issue #29087", () => {
  const pkgName = "create-bun-issue29087-argv-printer";
  const binName = "create-bun-issue29087-argv-printer";
  // Intentionally uses process.argv.slice(2): the script should only see args
  // the user passed after `bun create <name>`, not the separator.
  const script = `#!/usr/bin/env node\nconsole.log("ARGV:" + JSON.stringify(process.argv.slice(2)));\n`;

  let server: Server;
  let registryUrl: string;

  beforeAll(() => {
    const tarball = createTarball(pkgName, "1.0.0", binName, script);

    server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);

        // Tarball request
        if (url.pathname.endsWith(".tgz")) {
          return new Response(tarball, {
            status: 200,
            headers: { "Content-Type": "application/octet-stream" },
          });
        }

        // Package metadata
        if (url.pathname === `/${pkgName}`) {
          return Response.json({
            name: pkgName,
            "dist-tags": { latest: "1.0.0" },
            versions: {
              "1.0.0": {
                name: pkgName,
                version: "1.0.0",
                bin: { [binName]: "index.js" },
                dist: {
                  tarball: `${registryUrl}/${pkgName}/-/${pkgName}-1.0.0.tgz`,
                },
              },
            },
          });
        }

        return new Response("not found", { status: 404 });
      },
    });
    registryUrl = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
  });

  /** Run `bun create <args>` against the local registry and return the argv the create script received. */
  async function runCreate(...createArgs: string[]): Promise<{ argv: string[]; stdout: string; stderr: string }> {
    using dir = tempDir(`bun-create-29087`, {
      "bunfig.toml": `[install]\ncache = false\nregistry = "${registryUrl}/"\n`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "create", ...createArgs],
      cwd: String(dir),
      env: {
        ...bunEnv,
        // Make sure bunx hits our registry, not the real one.
        BUN_INSTALL_CACHE_DIR: String(dir) + "/.cache",
        npm_config_registry: `${registryUrl}/`,
      },
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const match = stdout.match(/ARGV:(.+)/);
    if (!match) {
      throw new Error(`Could not find ARGV line in stdout (exit ${exitCode}).\nstdout:\n${stdout}\nstderr:\n${stderr}`);
    }
    return { argv: JSON.parse(match[1]!), stdout, stderr };
  }

  test("strips a single leading `--` separator before forwarding to the create script", async () => {
    // "bun-issue29087-argv-printer" resolves to "create-bun-issue29087-argv-printer"
    const { argv } = await runCreate("bun-issue29087-argv-printer", "--", "-t", "v3");
    expect(argv).toEqual(["-t", "v3"]);
  });

  test("forwards long-form flags with no `--` separator unchanged", async () => {
    const { argv } = await runCreate("bun-issue29087-argv-printer", "--template", "v3");
    expect(argv).toEqual(["--template", "v3"]);
  });

  test("preserves a second `--` as a literal (only the first is the separator)", async () => {
    const { argv } = await runCreate("bun-issue29087-argv-printer", "--", "--", "-t", "v3");
    expect(argv).toEqual(["--", "-t", "v3"]);
  });

  test("does not leak `--bun` (consumed by wrapper) into forwarded argv", async () => {
    const { argv } = await runCreate("bun-issue29087-argv-printer", "--bun", "--", "-t", "v3");
    expect(argv).toEqual(["-t", "v3"]);
  });

  test("preserves `--bun` after separator as a literal arg for the create script", async () => {
    const { argv } = await runCreate("bun-issue29087-argv-printer", "--", "--bun", "-t", "v3");
    expect(argv).toEqual(["--bun", "-t", "v3"]);
  });
});
