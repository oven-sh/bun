// With colors on, `bun update --interactive` makes the name of a row a link (OSC 8) to npmjs.org.
import { describe, expect, it } from "bun:test";
import { once } from "events";
import { bunEnv, bunExe, tempDir, tls } from "harness";
import { connect, createServer, type AddressInfo, type Socket } from "net";
import { join } from "path";

// Has versions 1.0.0 and 2.0.0 of every name, or the versions listed for a name. It serves no
// tarballs, so the tests install with --lockfile-only and update with --dry-run.
function manifestRegistry(versionsOf: Record<string, string[]> = {}, tlsOptions?: typeof tls) {
  return Bun.serve({
    port: 0,
    tls: tlsOptions,
    fetch(req) {
      const { origin, pathname } = new URL(req.url);
      const name = decodeURIComponent(pathname.slice(1));
      const versions = versionsOf[name] ?? ["1.0.0", "2.0.0"];
      return Response.json({
        name,
        "dist-tags": { latest: versions.at(-1) },
        versions: Object.fromEntries(
          versions.map(version => [version, { name, version, dist: { tarball: `${origin}/${name}-${version}.tgz` } }]),
        ),
      });
    },
  });
}

// A name links to npmjs.org only when the registry is https://registry.npmjs.org/. With `env`,
// the registry stays at that URL and colors are on. Every https request goes through a tunnel
// that ends at a local manifest registry, whatever host the request names.
async function npmjsStandIn(versionsOf: Record<string, string[]> = {}) {
  const registry = manifestRegistry(versionsOf, tls);
  // Manifests are cached by registry URL, and CI gives the test files of a batch one cache.
  const cache = tempDir("update-interactive-links-cache", {});
  const sockets = new Set<Socket>();
  const tunnel = createServer(client => {
    sockets.add(client);
    client.on("error", () => client.destroy());
    client.on("close", () => sockets.delete(client));
    // The first packet is the whole `CONNECT registry.npmjs.org:443` request.
    client.once("data", () => {
      const upstream = connect(registry.port!, "127.0.0.1", () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        client.pipe(upstream).pipe(client);
      });
      sockets.add(upstream);
      upstream.on("error", () => client.destroy());
      upstream.on("close", () => sockets.delete(upstream));
    });
  });
  tunnel.listen(0, "127.0.0.1");
  await once(tunnel, "listening");
  const proxy = `http://127.0.0.1:${(tunnel.address() as AddressInfo).port}`;
  return {
    env: {
      ...bunEnv,
      FORCE_COLOR: "1",
      HTTPS_PROXY: proxy,
      https_proxy: proxy,
      // A registry of a scope is on localhost and takes no proxy.
      NO_PROXY: "localhost",
      no_proxy: "localhost",
      // The certificate of the local registry is not for registry.npmjs.org.
      NODE_TLS_REJECT_UNAUTHORIZED: "0",
      BUN_INSTALL_CACHE_DIR: String(cache),
    },
    async [Symbol.asyncDispose]() {
      for (const socket of sockets) socket.destroy();
      tunnel.close();
      await registry.stop(true);
      cache[Symbol.dispose]();
    },
  };
}

async function install(dir: string, env: typeof bunEnv) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install", "--lockfile-only"],
    cwd: dir,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toMatchObject({ exitCode: 0 });
}

// Types `input` into the prompt of a dry run. `a` selects every row, and a line feed confirms.
async function updateInteractive(dir: string, env: typeof bunEnv, input: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "update", "-i", "--latest", "--dry-run"],
    cwd: dir,
    env,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  proc.stdin.write(input);
  proc.stdin.end();
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// The frames of the prompt. Each one starts with the prompt line.
function frames(stdout: string) {
  return stdout.split("Select packages to update").slice(1);
}

// The header line and the package lines of the table, without escape sequences.
function tableLines(output: string) {
  return Bun.stripANSI(output)
    .split(/\r?\n/)
    .filter(line => line.includes("Current") || line.includes("□"));
}

// The rows that a dry run prints for the selected packages, without escape sequences.
function dryRunRows(output: string) {
  return Bun.stripANSI(output)
    .split(/\r?\n/)
    .filter(line => line.startsWith("↑"));
}

// The links of `output`: the URL of each one, by its text.
function links(output: string) {
  return Object.fromEntries(
    Array.from(output.matchAll(/\x1b\]8;;([^\x1b]*)\x1b\\([^\x1b]*)\x1b\]8;;\x1b\\/g), ([, url, text]) => [text, url]),
  );
}

// These run one at a time. Each one has a TLS registry and a tunnel in this process, and together
// they do not fit in the default timeout of a debug build.
describe("bun update --interactive links", () => {
  // `bun install` refuses a key with a control character. A bun.lock of an older bun can have one.
  it("should not write a control character of a key to the terminal", async () => {
    await using npmjs = await npmjsStandIn();
    const dependencies = { "esc\x1b]0;title\x07key": "npm:is-odd@1.0.0" };
    await using dir = tempDir("update-interactive-key-bytes", {
      "bunfig.toml": `[install]\ncache = false\n`,
      "package.json": JSON.stringify({ name: "test-project", version: "1.0.0", dependencies }),
      "bun.lock": JSON.stringify({
        lockfileVersion: 1,
        workspaces: { "": { name: "test-project", dependencies } },
        packages: { "esc\x1b]0;title\x07key": ["is-odd@1.0.0", "", {}, ""] },
      }),
    });

    const { stdout, exitCode } = await updateInteractive(String(dir), npmjs.env, "a\n");

    const [unselected] = frames(stdout);
    expect(links(unselected)).toEqual({ "esc\\x1b]0;title\\x07key": "https://npmjs.org/package/is-odd/v/1.0.0" });
    expect(dryRunRows(stdout)).toEqual(["↑ esc\\x1b]0;title\\x07key 1.0.0 → 2.0.0"]);
    expect(stdout).not.toContain("\x1b]0;");
    expect(exitCode).toBe(0);
  });

  // OSC 8 allows only the bytes 32 to 126 in the URL of a link. The package-lock.json migration
  // takes the name of a package as it is, and the part after `#` does not reach the registry.
  it("should write a byte of a link that OSC 8 does not allow as %XX", async () => {
    await using npmjs = await npmjsStandIn();
    const dependencies = { "café": "1.0.0", "num": "npm:is-number@1.0.0" };
    const integrity = "sha512-41Cifkg6e8TylSpdtTpeLVMqvSBEVzTttHvERD741+pnZ8ANv0004MRL43QKPDlK9cGvNp6NZWZUBlbGXYxxng==";
    await using dir = tempDir("update-interactive-link-bytes", {
      "bunfig.toml": `[install]\ncache = false\n`,
      "package.json": JSON.stringify({ name: "test-project", version: "1.0.0", dependencies }),
      "package-lock.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        lockfileVersion: 3,
        requires: true,
        packages: {
          "": { name: "test-project", version: "1.0.0", dependencies },
          "node_modules/café": {
            version: "1.0.0",
            resolved: "https://registry.npmjs.org/café/-/café-1.0.0.tgz",
            integrity,
          },
          "node_modules/num": {
            // The bytes 0x1f and 0x7f are the first ones outside the range, on each side.
            name: "is-number#\x1b]0;title\x07 \x1f~\x7f",
            version: "1.0.0",
            resolved: "https://registry.npmjs.org/is-number/-/is-number-1.0.0.tgz",
            integrity,
          },
        },
      }),
    });

    const { stdout, exitCode } = await updateInteractive(String(dir), npmjs.env, "\n");

    const table = [
      "  dependencies Current  Target  Latest",
      "  ❯ □ café     1.0.0    1.0.0   2.0.0",
      "    □ num      1.0.0    1.0.0   2.0.0",
    ];
    expect(tableLines(stdout)).toEqual(table);
    expect(links(stdout)).toEqual({
      "café": "https://npmjs.org/package/caf%C3%A9/v/1.0.0",
      "num": "https://npmjs.org/package/is-number#%1B]0;title%07 %1F~%7F/v/1.0.0",
    });
    expect(exitCode).toBe(0);

    // Without colors the same rows have no link.
    const plain = await updateInteractive(String(dir), { ...npmjs.env, FORCE_COLOR: undefined }, "\n");
    expect(tableLines(plain.stdout)).toEqual(table);
    expect(plain.stdout).not.toContain("\x1b]8;;");
    expect(plain.exitCode).toBe(0);
  });

  // bun.lockb holds the tag of a version as bytes, and nothing checks them when it is read.
  it("should not write a control character of a version to the terminal", async () => {
    await using npmjs = await npmjsStandIn({ "tagged": ["1.0.0-XXXXXX", "2.0.0"] });
    await using dir = tempDir("update-interactive-version-bytes", {
      "bunfig.toml": `[install]\ncache = false\nsaveTextLockfile = false\n`,
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: { "tagged": "1.0.0-XXXXXX" },
      }),
    });

    await install(String(dir), npmjs.env);
    // An escape sequence of the same length takes the place of the tag.
    const lockbPath = join(String(dir), "bun.lockb");
    const lockb = Buffer.from(await Bun.file(lockbPath).arrayBuffer());
    const tag = lockb.indexOf("XXXXXX\0\0");
    expect(tag).toBeGreaterThan(0);
    lockb.write("\x1b]0;T\x07", tag, "latin1");
    await Bun.write(lockbPath, lockb);

    const { stdout, exitCode } = await updateInteractive(String(dir), npmjs.env, "a\n");

    const [unselected] = frames(stdout);
    expect(links(unselected)).toEqual({ "tagged": "https://npmjs.org/package/tagged/v/1.0.0-%1B]0;T%07" });
    expect(dryRunRows(stdout)).toEqual(["↑ tagged 1.0.0-\\x1b]0;T\\x07 → 2.0.0"]);
    expect(stdout).not.toContain("\x1b]0;");
    expect(exitCode).toBe(0);
  });

  // The key of an alias is only what package.json calls the package. Another package can have
  // that name on npmjs.org, and the scope of the key can have another registry than the package.
  it("should link a name to the package that is installed under it", async () => {
    await using npmjs = await npmjsStandIn();
    await using other = manifestRegistry();
    await using dir = tempDir("update-interactive-link", {
      "bunfig.toml": `[install]\ncache = false\n\n[install.scopes]\n"@corp" = "${other.url}"\n"@jsr" = "${other.url}"\n`,
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        workspaces: [],
        catalog: { "from-catalog": "npm:is-odd@1.0.0" },
        dependencies: {
          "plain": "1.0.0",
          "@types/plain": "1.0.0",
          "num": "npm:is-number@1.0.0",
          "types": "npm:@types/is-number@1.0.0",
          "from-catalog": "catalog:",
          "@corp/direct": "1.0.0",
          "@corp/public": "npm:left-pad@1.0.0",
          // What `jsr add` writes. The `@jsr` scope has its own registry.
          "@std/semver": "npm:@jsr/std__semver@1.0.0",
        },
      }),
    });

    await install(String(dir), npmjs.env);
    const { stdout, exitCode } = await updateInteractive(String(dir), npmjs.env, "a\n");

    // The `a` key selects every row in the second frame.
    const [unselected, selected] = frames(stdout);
    expect(tableLines(unselected)).toEqual([
      "  dependencies      Current  Target  Latest",
      "  ❯ □ @corp/direct  1.0.0    1.0.0   2.0.0",
      "    □ @corp/public  1.0.0    1.0.0   2.0.0",
      "    □ @std/semver   1.0.0    1.0.0   2.0.0",
      "    □ @types/plain  1.0.0    1.0.0   2.0.0",
      "    □ from-catalog  1.0.0    1.0.0   2.0.0",
      "    □ num           1.0.0    1.0.0   2.0.0",
      "    □ plain         1.0.0    1.0.0   2.0.0",
      "    □ types         1.0.0    1.0.0   2.0.0",
    ]);
    // `@corp/direct` and `@std/semver` are packages of the other registry, so they have no link.
    expect(links(unselected)).toEqual({
      "@corp/public": "https://npmjs.org/package/left-pad/v/1.0.0",
      "@types/plain": "https://npmjs.org/package/@types/plain/v/1.0.0",
      "from-catalog": "https://npmjs.org/package/is-odd/v/1.0.0",
      "num": "https://npmjs.org/package/is-number/v/1.0.0",
      "plain": "https://npmjs.org/package/plain/v/1.0.0",
      "types": "https://npmjs.org/package/@types/is-number/v/1.0.0",
    });
    // A selected row links to the version that it updates to.
    expect(links(selected)).toEqual({
      "@corp/public": "https://npmjs.org/package/left-pad/v/2.0.0",
      "@types/plain": "https://npmjs.org/package/@types/plain/v/2.0.0",
      "from-catalog": "https://npmjs.org/package/is-odd/v/2.0.0",
      "num": "https://npmjs.org/package/is-number/v/2.0.0",
      "plain": "https://npmjs.org/package/plain/v/2.0.0",
      "types": "https://npmjs.org/package/@types/is-number/v/2.0.0",
    });
    expect(exitCode).toBe(0);
  });
});
