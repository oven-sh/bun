import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";

// Linux sun_path is 108 bytes. Bun works around longer paths by opening the
// parent directory and binding to "/proc/self/fd/<dirfd>/<basename>". The
// workaround previously passed the caller's ptr+len path buffer to snprintf
// via "%s", which reads past the end of a non-NUL-terminated allocation.
// Under ASan this aborts; on release the bound address is built from
// out-of-bounds heap bytes.

describe.skipIf(!isLinux)("unix domain socket long-path workaround", () => {
  function makeSockPath(prefix: string, total: number) {
    // Pad the directory so tempDir() returns something long enough to leave a
    // short basename that still fits inside /proc/self/fd/N/.
    const pad = Buffer.alloc(Math.max(0, total - 60), "d").toString();
    const dir = tempDir(prefix + pad, {});
    const basenameLen = total - String(dir).length - 1;
    const sock = String(dir) + "/" + Buffer.alloc(basenameLen, "l").toString();
    expect(sock.length).toBe(total);
    return { dir, sock };
  }

  async function run(fixture: string, sock: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      // symbolize=0: the regression this covers aborts under ASan, and four
      // concurrent llvm-symbolizer invocations blow past the default test
      // timeout. The assertion only needs the ASan header, not the stack.
      env: { ...bunEnv, SOCK: sock, ASAN_OPTIONS: (bunEnv.ASAN_OPTIONS ?? "") + ":symbolize=0" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // ASan reports are the failure mode of interest; surface the header while
    // keeping benign debug/ASan-option chatter out of the assertion.
    const asan = stderr.includes("AddressSanitizer") ? stderr.split("\n").slice(0, 4).join("\n") : "";
    return { stdout, asan, exitCode };
  }

  // 108 is the exact boundary where the workaround engages; 150 exercises a
  // longer directory prefix with the same short basename.
  for (const total of [108, 150]) {
    test.concurrent(`net.createServer + net.connect round-trip over a ${total}-byte path`, async () => {
      const { dir, sock } = makeSockPath("sun-long-net-", total);
      using _ = dir;

      const fixture = `
        const net = require("node:net");
        const path = process.env.SOCK;
        const srv = net.createServer(c => c.on("data", d => c.write(d)));
        srv.on("error", e => { console.log("listen error:", e.code ?? e.message); process.exit(1); });
        srv.listen(path, () => {
          const client = net.connect(path);
          client.on("data", d => {
            console.log("echo:" + d.toString());
            client.end();
            srv.close(() => process.exit(0));
          });
          client.on("connect", () => client.write("hello"));
          client.on("error", e => { console.log("connect error:", e.code ?? e.message); process.exit(1); });
        });
      `;

      expect(await run(fixture, sock)).toEqual({
        stdout: "echo:hello\n",
        asan: "",
        exitCode: 0,
      });
    });

    test.concurrent(`Bun.listen + Bun.connect round-trip over a ${total}-byte path`, async () => {
      const { dir, sock } = makeSockPath("sun-long-bun-", total);
      using _ = dir;

      const fixture = `
        const path = process.env.SOCK;
        const listener = Bun.listen({
          unix: path,
          socket: {
            data(s, d) { s.write(d); },
            open() {},
          },
        });
        const { promise, resolve, reject } = Promise.withResolvers();
        Bun.connect({
          unix: path,
          socket: {
            open(s) { s.write("hello"); },
            data(s, d) { console.log("echo:" + d.toString()); s.end(); resolve(); },
            error(s, e) { reject(e); },
            connectError(s, e) { reject(e); },
          },
        }).catch(reject);
        await promise;
        listener.stop();
      `;

      expect(await run(fixture, sock)).toEqual({
        stdout: "echo:hello\n",
        asan: "",
        exitCode: 0,
      });
    });
  }
});
