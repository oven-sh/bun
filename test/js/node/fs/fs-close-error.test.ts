// A file system can report a write error first at close(2): NFS, SMB and FUSE
// do that for ENOSPC, EDQUOT and EIO. The write itself returned success, so the
// close is the only report. Node passes the error of the close to the caller,
// and a copy that ends with such a close fails.
//
// CI has no such mount. An LD_PRELOAD shim (fs-close-error-shim.c) fails the
// close of each file named "<name>.<errno>.close-fault" that is open for
// writing, after the descriptor is released, and writes one line to stderr for
// it. The shim interposes libc's syscall(), so these tests need glibc.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isGlibc, tempDir } from "harness";
import { mkfifo } from "mkfifo";
import { symlinkSync } from "node:fs";
import { constants } from "node:os";
import { join } from "node:path";

const cc = isGlibc ? Bun.which("cc") || Bun.which("gcc") || Bun.which("clang") : null;
const { ENOSPC, EDQUOT, EIO, EINTR, EINPROGRESS } = constants.errno;
const fault = `${ENOSPC}.close-fault`;
const failed = (...errnos: number[]) => errnos.map(errno => `close-fault: errno ${errno}`);

// `settle(fn)` is what the call did: "returned", or the code and the syscall of its error.
const settle = /* js */ `
  const settle = async fn => {
    try {
      await fn();
      return "returned";
    } catch (e) {
      return e.code + " " + e.syscall;
    }
  };
`;

const nodeFsFixture = /* js */ `
  const fs = require("node:fs");
  const data = Buffer.alloc(4096, "a");
  ${settle}
  const out = { closeSync: {} };

  for (const [name, errno] of Object.entries(${JSON.stringify({ ENOSPC, EDQUOT, EIO, EINTR, EINPROGRESS })})) {
    const fd = fs.openSync("closeSync." + errno + ".close-fault", "w");
    fs.writeSync(fd, data);
    out.closeSync[name] = await settle(() => fs.closeSync(fd));
  }

  const fd = fs.openSync("close.${fault}", "w");
  fs.writeSync(fd, data);
  out.close = await settle(() => new Promise((resolve, reject) => fs.close(fd, e => (e ? reject(e) : resolve()))));

  const handle = await fs.promises.open("FileHandle.${fault}", "w");
  await handle.write(data);
  out.fileHandle = { close: await settle(() => handle.close()), fd: handle.fd };

  const stream = fs.createWriteStream("stream.${fault}");
  out.createWriteStream = await settle(
    () => new Promise((resolve, reject) => stream.on("error", reject).on("close", resolve).end(data)),
  );

  // These two close their own descriptor and drop the result of the close.
  await settle(() => fs.writeFileSync("writeFileSync.${fault}", data));
  await settle(() => Bun.write("bun-write.${fault}", data));
  out.afterInternalCloses = "alive";

  console.log(JSON.stringify(out));
`;

// respondWithFile opens the file for reading. When statCheck cancels the send, http2 closes the descriptor.
const http2Fixture = /* js */ `
  const http2 = require("node:http2");
  const fail = e => {
    console.log(JSON.stringify({ error: String(e) }));
    process.exit(1);
  };
  const server = http2.createServer();
  server.on("error", fail);
  server.on("stream", stream => {
    stream.respondWithFile("body.${EIO}.close-fault", {}, {
      statCheck() {
        stream.respond({ ":status": 200 });
        stream.end("from statCheck");
        return false;
      },
    });
  });
  server.listen(0, () => {
    const client = http2.connect("http://localhost:" + server.address().port);
    client.on("error", fail);
    const request = client.request({ ":path": "/" });
    request.on("error", fail);
    let body = "";
    request.setEncoding("utf8");
    request.on("data", chunk => (body += chunk));
    request.on("end", () => {
      client.close();
      server.close();
      console.log(JSON.stringify({ body }));
    });
    request.end();
  });
`;

// `at(path)` is what the path holds after the copy.
const copyPrelude = /* js */ `
  const fs = require("node:fs");
  const source = Buffer.alloc(20000, "S");
  ${settle}
  const at = path => {
    try {
      if (fs.lstatSync(path).isFIFO()) return "a fifo";
      const bytes = fs.readFileSync(path);
      return bytes.length === 0 ? "empty" : bytes.equals(source) ? "the source bytes" : "other bytes";
    } catch (e) {
      return e.code;
    }
  };
`;

const copyApis = ["copyFileSync", "copyFile", "promises.copyFile", "cpSync", "cp", "promises.cp"];

const copyFixture = /* js */ `
  ${copyPrelude}
  const withCallback = (fn, dest) => new Promise((resolve, reject) => fn("src.bin", dest, e => (e ? reject(e) : resolve())));
  const apis = {
    "copyFileSync": dest => fs.copyFileSync("src.bin", dest),
    "copyFile": dest => withCallback(fs.copyFile, dest),
    "promises.copyFile": dest => fs.promises.copyFile("src.bin", dest),
    "cpSync": dest => fs.cpSync("src.bin", dest),
    "cp": dest => withCallback(fs.cp, dest),
    "promises.cp": dest => fs.promises.cp("src.bin", dest),
  };
  const out = { eintr: {} };

  for (const [api, copy] of Object.entries(apis)) {
    const dest = api + ".${fault}";
    out[api] = { result: await settle(() => copy(dest)), dest: at(dest) };
  }
  for (const api of ["copyFileSync", "cpSync"]) {
    const dest = api + ".${EINTR}.close-fault";
    out.eintr[api] = { result: await settle(() => apis[api](dest)), dest: at(dest) };
  }

  out.existing = { result: await settle(() => fs.copyFileSync("src.bin", "existing.${fault}")), dest: at("existing.${fault}") };
  out.symlink = {
    result: await settle(() => fs.copyFileSync("src.bin", "link")),
    link: fs.lstatSync("link", { throwIfNoEntry: false }) !== undefined,
    target: at("target.${fault}"),
  };
  out.source = { result: await settle(() => fs.copyFileSync("same.${fault}", "same.${fault}")), dest: at("same.${fault}") };
  out.directory = {
    result: await settle(() => fs.cpSync("tree", "tree-copy", { recursive: true })),
    copied: fs.readdirSync("tree-copy"),
  };
  // This descriptor is the reader of the fifo, so the copy does not wait for one.
  fs.openSync("fifo.${fault}", fs.constants.O_RDWR);
  out.fifo = { result: await settle(() => fs.copyFileSync("small.bin", "fifo.${fault}")), dest: at("fifo.${fault}") };

  console.log(JSON.stringify(out));
`;

// A reflink ends the copy at another place in the code. With CLOSE_FAULT_FICLONE the shim makes
// FICLONE report success and copy nothing, so an empty destination shows that the copy took that exit.
const ficloneFixture = /* js */ `
  ${copyPrelude}
  const apis = {
    "copyFileSync": dest => fs.copyFileSync("src.bin", dest),
    "copyFileSync FICLONE_FORCE": dest => fs.copyFileSync("src.bin", dest, fs.constants.COPYFILE_FICLONE_FORCE),
    "cpSync": dest => fs.cpSync("src.bin", dest),
  };
  const out = { enospc: {}, eintr: {} };
  for (const [name, errno] of [["enospc", ${ENOSPC}], ["eintr", ${EINTR}]]) {
    for (const [api, copy] of Object.entries(apis)) {
      const dest = api.replace(" ", "-") + "." + errno + ".close-fault";
      out[name][api] = { result: await settle(() => copy(dest)), dest: at(dest) };
    }
  }
  console.log(JSON.stringify(out));
`;

describe.skipIf(!cc)("a close(2) that reports an error", () => {
  type Result = { stdout: any; stderr: string[]; exitCode: number };
  const dirs: ReturnType<typeof tempDir>[] = [];
  let nodeFs: Result, http2: Result, copy: Result, ficlone: Result;

  // One process for each fixture runs all of its cases. Each close that the shim fails is one line
  // of stderr. The timeout is for debug builds: they take seconds to load node:stream and node:http2.
  beforeAll(async () => {
    const fixtureDir = (files: Record<string, string | Buffer>) => {
      const dir = tempDir("fs-close-error", files);
      dirs.push(dir);
      return String(dir);
    };

    const shim = join(fixtureDir({}), "shim.so");
    await using compile = Bun.spawn({
      cmd: [cc!, "-shared", "-fPIC", "-o", shim, join(import.meta.dir, "fs-close-error-shim.c"), "-ldl"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, compiled] = await Promise.all([compile.stdout.text(), compile.stderr.text(), compile.exited]);
    if (compiled !== 0) throw new Error(`Failed to build the shim:\n${err || out}`);

    async function run(cwd: string, env: Record<string, string> = {}): Promise<Result> {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "main.mjs"],
        env: { ...bunEnv, LD_PRELOAD: bunEnv.LD_PRELOAD ? `${shim}:${bunEnv.LD_PRELOAD}` : shim, ...env },
        cwd,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      let parsed: unknown = stdout;
      try {
        parsed = JSON.parse(stdout);
      } catch {}
      return {
        stdout: parsed,
        stderr: stderr.split("\n").filter(line => line.length > 0 && !line.startsWith("WARNING: ASAN interferes")),
        exitCode,
      };
    }

    const source = Buffer.alloc(20000, "S");
    // body.*: written here, without the shim. The http2 server only reads it.
    const http2Dir = fixtureDir({ "main.mjs": http2Fixture, [`body.${EIO}.close-fault`]: "hello" });
    const copyDir = fixtureDir({
      "main.mjs": copyFixture,
      "src.bin": source,
      [`existing.${fault}`]: Buffer.alloc(50000, "D"),
      [`target.${fault}`]: Buffer.alloc(50000, "D"),
      [`same.${fault}`]: source,
      "tree": { [`file.${fault}`]: source },
      // Less than a pipe holds, so the copy into the fifo completes while nothing reads it.
      "small.bin": Buffer.alloc(1000, "S"),
    });
    symlinkSync(`target.${fault}`, join(copyDir, "link"));
    mkfifo(join(copyDir, `fifo.${fault}`), 0o666);

    [nodeFs, http2, copy, ficlone] = await Promise.all([
      run(fixtureDir({ "main.mjs": nodeFsFixture })),
      run(http2Dir, { CLOSE_FAULT_READERS: "1" }),
      run(copyDir),
      run(fixtureDir({ "main.mjs": ficloneFixture, "src.bin": source }), { CLOSE_FAULT_FICLONE: "1" }),
    ]);
  }, 60_000);

  afterAll(() => {
    for (const dir of dirs) dir[Symbol.dispose]();
  });

  describe("node:fs", () => {
    test("fs.closeSync throws ENOSPC, EDQUOT and EIO, and not EINTR or EINPROGRESS", () => {
      expect(nodeFs.stdout.closeSync).toEqual({
        ENOSPC: "ENOSPC close",
        EDQUOT: "EDQUOT close",
        EIO: "EIO close",
        // libuv: "The close is in progress, not an error."
        EINTR: "returned",
        EINPROGRESS: "returned",
      });
    });

    test("fs.close passes it to the callback", () => {
      expect(nodeFs.stdout.close).toBe("ENOSPC close");
    });

    test("FileHandle.close rejects, and the handle is closed", () => {
      expect(nodeFs.stdout.fileHandle).toEqual({ close: "ENOSPC close", fd: -1 });
    });

    test("fs.createWriteStream emits it", () => {
      expect(nodeFs.stdout.createWriteStream).toBe("ENOSPC close");
    });

    // A debug build asserts on a close whose result bun drops. The assert is for EBADF, a use after close.
    test("a descriptor that bun closes for itself does not end the process", () => {
      expect({ afterInternalCloses: nodeFs.stdout.afterInternalCloses, exitCode: nodeFs.exitCode }).toEqual({
        afterInternalCloses: "alive",
        exitCode: 0,
      });
    });

    test("each descriptor is closed once", () => {
      expect(nodeFs.stderr).toEqual(
        failed(ENOSPC, EDQUOT, EIO, EINTR, EINPROGRESS, ENOSPC, ENOSPC, ENOSPC, ENOSPC, ENOSPC),
      );
    });
  });

  // Nothing can act on the result of this close. Node asserts on it.
  test("http2 respondWithFile ignores it", () => {
    expect(http2).toEqual({ stdout: { body: "from statCheck" }, stderr: failed(EIO), exitCode: 0 });
  });

  // Node (libuv uv_fs_copyfile) fails the copy with the error of the close, and removes the destination.
  describe("copyFile and cp", () => {
    test.each(copyApis)("%s fails and removes the destination", api => {
      expect(copy.stdout[api]).toEqual({ result: "ENOSPC copyfile", dest: "ENOENT" });
    });

    test("EINTR does not fail the copy", () => {
      const copied = { result: "returned", dest: "the source bytes" };
      expect(copy.stdout.eintr).toEqual({ copyFileSync: copied, cpSync: copied });
    });

    test("a destination that existed before is removed, as in node", () => {
      expect(copy.stdout.existing).toEqual({ result: "ENOSPC copyfile", dest: "ENOENT" });
    });

    // The target is not a name that the copy was given.
    test("a symlink is removed, and its target is kept", () => {
      expect(copy.stdout.symlink).toEqual({ result: "ENOSPC copyfile", link: false, target: "the source bytes" });
    });

    test("a destination that is the source is kept (node removes it)", () => {
      expect(copy.stdout.source).toEqual({ result: "ENOSPC copyfile", dest: "the source bytes" });
    });

    test("a fifo is kept (node removes it)", () => {
      expect(copy.stdout.fifo).toEqual({ result: "ENOSPC copyfile", dest: "a fifo" });
    });

    test("a recursive copy stops at the file whose close failed", () => {
      expect(copy.stdout.directory).toEqual({ result: "ENOSPC copyfile", copied: [] });
    });

    test("each destination is closed once", () => {
      expect({ stderr: copy.stderr, exitCode: copy.exitCode }).toEqual({
        stderr: failed(...copyApis.map(() => ENOSPC), EINTR, EINTR, ENOSPC, ENOSPC, ENOSPC, ENOSPC, ENOSPC),
        exitCode: 0,
      });
    });

    test("a copy by FICLONE fails and removes the destination", () => {
      const removed = { result: "ENOSPC copyfile", dest: "ENOENT" };
      const cloned = { result: "returned", dest: "empty" };
      expect(ficlone).toEqual({
        stdout: {
          enospc: { "copyFileSync": removed, "copyFileSync FICLONE_FORCE": removed, "cpSync": removed },
          eintr: { "copyFileSync": cloned, "copyFileSync FICLONE_FORCE": cloned, "cpSync": cloned },
        },
        stderr: failed(ENOSPC, ENOSPC, ENOSPC, EINTR, EINTR, EINTR),
        exitCode: 0,
      });
    });
  });
});
