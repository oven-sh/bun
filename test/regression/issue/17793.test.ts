// Regression test for https://github.com/oven-sh/bun/issues/17793
//
// Bug: In handleResponseMetadata (src/http.zig), the RFC 9112 §6.3 logic
// setting content_length=0 for 304 responses was inside `if (!proxy_tunneling)`,
// so 304 through CONNECT tunnels left content_length=null → continue_streaming → hang.
//
// This test is fully self-contained (no external proxy or internet needed):
// - Mock HTTPS registry (raw TLS server for full control over response headers)
// - Mock CONNECT proxy
// - Runs `bun install` twice: first populates cache, second triggers 304

import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir, tls as tlsCert } from "harness";
import { once } from "node:events";
import { readdir, rm } from "node:fs/promises";
import net from "node:net";
import { join } from "node:path";
import tls from "node:tls";

/**
 * Creates a minimal valid npm tarball (.tgz) containing only package/package.json.
 * Constructs a USTAR tar archive and gzip-compresses it.
 */
function createMinimalTarball(pkgJson: object): Buffer {
  const content = Buffer.from(JSON.stringify(pkgJson));
  const filename = "package/package.json";

  const header = Buffer.alloc(512, 0);
  header.write(filename, 0);
  header.write("0000644\0", 100); // mode
  header.write("0001000\0", 108); // uid
  header.write("0001000\0", 116); // gid
  header.write(content.length.toString(8).padStart(11, "0") + "\0", 124); // size
  header.write(
    Math.floor(Date.now() / 1000)
      .toString(8)
      .padStart(11, "0") + "\0",
    136,
  ); // mtime
  header.write("        ", 148); // checksum placeholder (8 spaces)
  header.write("0", 156); // typeflag: regular file
  header.write("ustar\0", 257); // magic
  header.write("00", 263); // version

  let checksum = 0;
  for (let i = 0; i < 512; i++) checksum += header[i];
  header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148);

  const dataBlocks = Buffer.alloc(Math.ceil(content.length / 512) * 512, 0);
  content.copy(dataBlocks);

  return Buffer.from(Bun.gzipSync(Buffer.concat([header, dataBlocks, Buffer.alloc(1024, 0)])));
}

test("bun install with proxy does not hang on 304 cached response", async () => {
  const pkgName = "test-pkg-304";
  const pkgVersion = "1.0.0";
  const etag = '"test-etag-304-regression"';
  const requests: Array<{ path: string; ifNoneMatch: boolean }> = [];

  const tarball = createMinimalTarball({ name: pkgName, version: pkgVersion });
  const shasum = new Bun.CryptoHasher("sha1").update(tarball).digest("hex");
  const integrity = "sha512-" + new Bun.CryptoHasher("sha512").update(tarball).digest("base64");

  // --- Mock HTTPS registry (raw TLS for full control over headers) ---
  // Using raw tls.createServer instead of Bun.serve because we need to send
  // 304 responses WITHOUT a Content-Length header. Bun.serve may auto-add it.
  let registryPort = 0;

  const registryServer = tls.createServer({ key: tlsCert.key, cert: tlsCert.cert }, (socket: tls.TLSSocket) => {
    let buf = Buffer.alloc(0);

    socket.on("data", (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);

      while (true) {
        const end = buf.indexOf("\r\n\r\n");
        if (end === -1) break;

        const headerStr = buf.subarray(0, end).toString();
        buf = buf.subarray(end + 4);

        const lines = headerStr.split("\r\n");
        const path = lines[0].split(" ")[1];
        const ifNoneMatch = lines.some(l => l.toLowerCase().startsWith("if-none-match:"));
        requests.push({ path, ifNoneMatch });

        if (path.endsWith(".tgz")) {
          socket.write(
            `HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: ${tarball.length}\r\n\r\n`,
          );
          socket.write(tarball);
        } else if (path.startsWith(`/${pkgName}`)) {
          if (ifNoneMatch) {
            // 304 WITHOUT Content-Length — this is what triggers the bug
            // when going through a CONNECT tunnel without the fix.
            socket.write(`HTTP/1.1 304 Not Modified\r\nETag: ${etag}\r\n\r\n`);
          } else {
            const manifest = JSON.stringify({
              name: pkgName,
              "dist-tags": { latest: pkgVersion },
              versions: {
                [pkgVersion]: {
                  name: pkgName,
                  version: pkgVersion,
                  dist: {
                    tarball: `https://localhost:${registryPort}/${pkgName}/-/${pkgName}-${pkgVersion}.tgz`,
                    shasum,
                    integrity,
                  },
                },
              },
            });
            socket.write(
              `HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(manifest)}\r\nETag: ${etag}\r\n\r\n${manifest}`,
            );
          }
        } else {
          socket.write("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n");
        }
      }
    });

    socket.on("error", () => {});
  });

  registryServer.listen(0);
  await once(registryServer, "listening");
  registryPort = (registryServer.address() as net.AddressInfo).port;

  // --- Mock CONNECT proxy ---
  const proxyServer = net.createServer((clientSocket: net.Socket) => {
    clientSocket.once("data", (data: Buffer) => {
      const match = data.toString().match(/^CONNECT\s+([^:]+):(\d+)\s+HTTP/);
      if (!match) {
        clientSocket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
        clientSocket.end();
        return;
      }

      const [, host, port] = match;
      const serverSocket = net.connect(parseInt(port), host, () => {
        clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        serverSocket.pipe(clientSocket, { end: false });
        clientSocket.pipe(serverSocket, { end: false });
      });

      serverSocket.on("error", () => clientSocket.destroy());
      clientSocket.on("error", () => serverSocket.destroy());
      clientSocket.on("close", () => serverSocket.destroy());
      serverSocket.on("close", () => clientSocket.destroy());
    });

    clientSocket.on("error", () => {});
  });

  proxyServer.listen(0);
  await once(proxyServer, "listening");
  const proxyPort = (proxyServer.address() as net.AddressInfo).port;

  // --- Test project ---
  // Use a version range (^) so bun revalidates the manifest on the second install.
  // Exact versions bypass revalidation even when the cache is expired.
  using dir = tempDir("proxy-304-regression", {
    "package.json": JSON.stringify({
      name: "test-project",
      version: "1.0.0",
      dependencies: { [pkgName]: `^${pkgVersion}` },
    }),
    "bunfig.toml": `[install]\nregistry = "https://localhost:${registryPort}/"\n`,
  });

  const installEnv = {
    ...bunEnv,
    HTTPS_PROXY: `http://localhost:${proxyPort}`,
    HTTP_PROXY: `http://localhost:${proxyPort}`,
    https_proxy: `http://localhost:${proxyPort}`,
    http_proxy: `http://localhost:${proxyPort}`,
    NO_PROXY: "",
    no_proxy: "",
    NODE_TLS_REJECT_UNAUTHORIZED: "0",
    BUN_INSTALL_CACHE_DIR: join(String(dir), ".bun-cache"),
  };

  const spawnInstall = (extraArgs: string[] = []) =>
    Bun.spawn({
      cmd: [bunExe(), "install", ...extraArgs],
      cwd: String(dir),
      env: installEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

  try {
    // First install: registry returns 200 + ETag → populates manifest cache
    {
      await using proc = spawnInstall();
      const [stdout, stderr, exitCode] = await Promise.all([
        proc.stdout.text(),
        proc.stderr.text(),
        Promise.race([proc.exited, new Promise<"timeout">(r => setTimeout(() => r("timeout"), 15000))]),
      ]);

      if (exitCode === "timeout") proc.kill();
      expect(exitCode).not.toBe("timeout");
      expect(exitCode).toBe(0);
    }

    // Wait for the async manifest cache save to complete.
    // bun saves manifests asynchronously; without this, the second install
    // may not find the cached manifest and skip the If-None-Match path.
    const cacheDir = join(String(dir), ".bun-cache");
    let cachePopulated = false;
    for (let i = 0; i < 40; i++) {
      const entries = await readdir(cacheDir).catch(() => []);
      if (entries.length > 0) {
        cachePopulated = true;
        break;
      }
      await Bun.sleep(50);
    }
    expect(cachePopulated).toBe(true);

    // Clear local artifacts but keep global manifest cache
    await rm(join(String(dir), "node_modules"), { recursive: true, force: true });
    await rm(join(String(dir), "bun.lock"), { force: true });

    // Second install with --force: bypasses manifest cache freshness check, so bun
    // revalidates with If-None-Match → 304 through CONNECT tunnel.
    // Without the fix, content_length stays null for 304 responses through proxy tunnels,
    // causing the connection to hang in continue_streaming.
    {
      await using proc = spawnInstall(["--force"]);
      const [stdout, stderr, exitCode] = await Promise.all([
        proc.stdout.text(),
        proc.stderr.text(),
        Promise.race([proc.exited, new Promise<"timeout">(r => setTimeout(() => r("timeout"), 15000))]),
      ]);

      if (exitCode === "timeout") proc.kill();
      expect(exitCode).not.toBe("timeout");
      expect(exitCode).toBe(0);
    }

    // Verify that the 304 code path was actually exercised
    const manifestReqs = requests.filter(r => r.path.startsWith(`/${pkgName}`) && !r.path.endsWith(".tgz"));
    expect(manifestReqs.length).toBeGreaterThanOrEqual(2);
    expect(manifestReqs.some(r => r.ifNoneMatch)).toBe(true);
  } finally {
    registryServer.close();
    proxyServer.close();
  }
});
