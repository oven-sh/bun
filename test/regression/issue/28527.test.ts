import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Auto-install for `bun build` / `Bun.build()` (issue #28527), served from a
// local registry so the test never contacts npm. The package below provides
// `isOdd`; each test builds an entry that imports it, then runs the bundle
// with --no-install so runtime auto-install cannot mask a bad bundle.

const pkgName = "pkg-28527";
const pkgVersion = "1.0.0";

/** One USTAR tar entry (header + zero-padded data blocks). */
function tarEntry(name: string, content: Buffer): Buffer {
  const header = Buffer.alloc(512, 0);
  header.write(name, 0);
  header.write("0000644\0", 100); // mode
  header.write("0001000\0", 108); // uid
  header.write("0001000\0", 116); // gid
  header.write(content.length.toString(8).padStart(11, "0") + "\0", 124); // size
  header.write("00000000000\0", 136); // mtime
  header.write("        ", 148); // checksum placeholder
  header.write("0", 156); // typeflag: regular file
  header.write("ustar\0", 257);
  header.write("00", 263);
  let checksum = 0;
  for (let i = 0; i < 512; i++) checksum += header[i];
  header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148);
  const data = Buffer.alloc(Math.ceil(content.length / 512) * 512, 0);
  content.copy(data);
  return Buffer.concat([header, data]);
}

function createTarball(files: Record<string, string>): Buffer {
  const parts = Object.entries(files).map(([name, content]) => tarEntry(name, Buffer.from(content)));
  parts.push(Buffer.alloc(1024, 0)); // end-of-archive
  return Buffer.from(Bun.gzipSync(Buffer.concat(parts)));
}

const tarball = createTarball({
  "package/package.json": JSON.stringify({ name: pkgName, version: pkgVersion, main: "index.js" }),
  "package/index.js": "module.exports = function isOdd(n) { return n % 2 === 1; };\n",
});
const shasum = new Bun.CryptoHasher("sha1").update(tarball).digest("hex");
const integrity = "sha512-" + new Bun.CryptoHasher("sha512").update(tarball).digest("base64");

function startRegistry(requests: string[]) {
  const registry = Bun.serve({
    port: 0,
    fetch(req) {
      const path = new URL(req.url).pathname;
      requests.push(path);
      if (path.endsWith(".tgz")) {
        return new Response(tarball);
      }
      if (path === `/${pkgName}`) {
        return Response.json({
          name: pkgName,
          "dist-tags": { latest: pkgVersion },
          versions: {
            [pkgVersion]: {
              name: pkgName,
              version: pkgVersion,
              dist: {
                tarball: `http://127.0.0.1:${registry.port}/${pkgName}/-/${pkgName}-${pkgVersion}.tgz`,
                shasum,
                integrity,
              },
            },
          },
        });
      }
      return new Response("not found", { status: 404 });
    },
  });
  return registry;
}

test.concurrent("Bun.build auto-installs dependencies without package.json", async () => {
  const requests: string[] = [];
  using registry = startRegistry(requests);

  using dir = tempDir("issue-28527", {
    "entry.ts": `import isOdd from "${pkgName}"; console.log(isOdd(3));`,
    "build.ts": `
const result = await Bun.build({
  entrypoints: ["./entry.ts"],
  outdir: "./out",
});
if (!result.success) {
  for (const msg of result.logs) console.error(msg);
  process.exit(1);
}
console.log("BUILD_OK");
`,
    "bunfig.toml": `[install]\nregistry = "http://127.0.0.1:${registry.port}/"\n`,
  });

  const env = { ...bunEnv, BUN_INSTALL_CACHE_DIR: `${String(dir)}/cache` };

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build.ts"],
    env,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("Could not resolve");
  expect(stdout).toContain("BUILD_OK");
  expect(exitCode).toBe(0);
  expect(requests).toContain(`/${pkgName}`);

  // The bundle must actually contain the package and run standalone:
  // --no-install keeps runtime auto-install from masking a bad bundle.
  await using run = Bun.spawn({
    cmd: [bunExe(), "--no-install", `${String(dir)}/out/entry.js`],
    env,
    stderr: "pipe",
  });
  const [runOut, runErr, runExit] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);
  expect(runErr).toBe("");
  expect(runOut.trim()).toBe("true");
  expect(runExit).toBe(0);
});

test.concurrent("bun build CLI auto-installs dependencies without package.json", async () => {
  const requests: string[] = [];
  using registry = startRegistry(requests);

  using dir = tempDir("issue-28527-cli", {
    "entry.ts": `import isOdd from "${pkgName}"; console.log(isOdd(3));`,
    "bunfig.toml": `[install]\nregistry = "http://127.0.0.1:${registry.port}/"\n`,
  });

  const env = { ...bunEnv, BUN_INSTALL_CACHE_DIR: `${String(dir)}/cache` };

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "entry.ts", "--outdir", "./out"],
    env,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("Could not resolve");
  expect(exitCode).toBe(0);
  expect(requests).toContain(`/${pkgName}`);

  // The bundle must actually contain the package and run standalone:
  // --no-install keeps runtime auto-install from masking a bad bundle.
  await using run = Bun.spawn({
    cmd: [bunExe(), "--no-install", `${String(dir)}/out/entry.js`],
    env,
    stderr: "pipe",
  });
  const [runOut, runErr, runExit] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);
  expect(runErr).toBe("");
  expect(runOut.trim()).toBe("true");
  expect(runExit).toBe(0);
});
