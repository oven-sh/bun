import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, tempDir } from "harness";

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

// Linux and macOS both open the parent directory to shorten the address. When
// that open() fails, the errno it set (ENOENT, ENOTDIR, EACCES) is the error
// the user sees, the same as for a path that fits sun_path.
describe.skipIf(isWindows)("unix domain socket long-path workaround: parent directory errors", () => {
  // 120 bytes is past sun_path on both Linux (108) and macOS (104). The
  // padding goes into the parent component, so the path is at least that long
  // whatever TMPDIR is and the basename stays short.
  function makeSockPath(prefix: string, parent: "missing" | "file", minLength: number) {
    const dir = tempDir(prefix, parent === "file" ? { file: "" } : {});
    const component = parent === "file" ? "/file/" : "/missing-";
    const padLen = Math.max(1, minLength - String(dir).length - component.length - "/s.sock".length);
    const pad = Buffer.alloc(padLen, "d").toString();
    const sock = String(dir) + component + pad + "/s.sock";
    expect(sock.length).toBeGreaterThanOrEqual(minLength);
    return { dir, sock };
  }

  async function run(fixture: string, sock: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: { ...bunEnv, SOCK: sock },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  const fixtures = {
    "net.connect": `
      const net = require("node:net");
      net.connect(process.env.SOCK)
        .on("connect", () => { console.log("connected"); process.exit(1); })
        .on("error", e => { console.log("error:" + e.code + " syscall:" + e.syscall); process.exit(0); });
    `,
    "net.createServer().listen": `
      const net = require("node:net");
      net.createServer()
        .on("listening", () => { console.log("listening"); process.exit(1); })
        .on("error", e => { console.log("error:" + e.code + " syscall:" + e.syscall); process.exit(0); })
        .listen(process.env.SOCK);
    `,
    "Bun.connect": `
      let cbCode = null;
      try {
        await Bun.connect({
          unix: process.env.SOCK,
          socket: { connectError(_s, e) { cbCode = e.code; }, data() {} },
        });
        console.log("connected");
      } catch (e) {
        console.log("error:" + e.code + " connectError:" + cbCode);
      }
    `,
    "Bun.listen": `
      try {
        Bun.listen({ unix: process.env.SOCK, socket: { data() {} } });
        console.log("listening");
      } catch (e) {
        console.log("error:" + e.code);
      }
    `,
    "Bun.serve": `
      try {
        Bun.serve({ unix: process.env.SOCK, fetch() { return new Response("ok"); } });
        console.log("listening");
      } catch (e) {
        console.log("error:" + e.code);
      }
    `,
  };

  const expected = {
    "net.connect": (code: string) => `error:${code} syscall:connect\n`,
    "net.createServer().listen": (code: string) => `error:${code} syscall:listen\n`,
    "Bun.connect": (code: string) => `error:${code} connectError:${code}\n`,
    "Bun.listen": (code: string) => `error:${code}\n`,
    "Bun.serve": (code: string) => `error:${code}\n`,
  };

  describe.each([
    ["missing", "ENOENT"],
    ["file", "ENOTDIR"],
  ] as const)("parent is %s", (parent, code) => {
    for (const api of Object.keys(fixtures) as (keyof typeof fixtures)[]) {
      test.concurrent(`${api} reports ${code}`, async () => {
        const { dir, sock } = makeSockPath(`sun-long-${code}-`, parent, 120);
        using _ = dir;
        expect(await run(fixtures[api], sock)).toEqual({
          stdout: expected[api](code),
          stderr: "",
          exitCode: 0,
        });
      });
    }
  });
});
