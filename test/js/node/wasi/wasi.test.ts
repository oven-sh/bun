import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import * as fs from "node:fs";
import * as path from "node:path";
import { WASI } from "node:wasi";

// Builds a minimal `wasi_snapshot_preview1` module in-memory. `imps` is a list of
// [hostcallName, signature] pairs that become imports re-exported as f0..fN; the
// module also exports its memory and a single nullary function (name/body overridable).
function craftModule(
  imps: Array<[string, string]>,
  startBody: number[] = [],
  startName: string | null = "_start",
): Uint8Array {
  const u = (x: number) => {
    const a: number[] = [];
    do {
      let c = x & 127;
      x >>>= 7;
      if (x) c |= 128;
      a.push(c);
    } while (x);
    return a;
  };
  const str = (s: string) => [...u(s.length), ...[...s].map(c => c.charCodeAt(0))];
  const sec = (id: number, b: number[]) => [id, ...u(b.length), ...b];
  const N = imps.length;
  const T: Record<string, number> = { i: 0x7f, j: 0x7e };
  const types = [
    ...u(N + 1),
    ...imps.flatMap(([, s]) => [0x60, s.length, ...[...s].map(c => T[c]), 1, 0x7f]),
    0x60,
    0,
    0,
  ];
  const imports = [...u(N), ...imps.flatMap(([n], k) => [...str("wasi_snapshot_preview1"), ...str(n), 0, k])];
  const funcs = [...u(N + 1), ...imps.map((_, k) => k), N];
  const exps = [
    ...u(N + 1 + (startName ? 1 : 0)),
    ...imps.flatMap((_, k) => [...str("f" + k), 0, N + k]),
    ...(startName ? [...str(startName), 0, 2 * N] : []),
    ...str("memory"),
    2,
    0,
  ];
  const codes = imps.map(([, s], k) => {
    const c = [0, ...[...s].flatMap((_, j) => [0x20, j]), 0x10, k, 0x0b];
    return [...u(c.length), ...c];
  });
  const sb = [0, ...startBody, 0x0b];
  const code = [...u(N + 1), ...codes.flat(), ...u(sb.length), ...sb];
  return new Uint8Array([
    0,
    97,
    115,
    109,
    1,
    0,
    0,
    0,
    ...sec(1, types),
    ...sec(2, imports),
    ...sec(3, funcs),
    ...sec(5, [1, 0, 1]),
    ...sec(7, exps),
    ...sec(10, code),
  ]);
}

// prettier-ignore
// _start: write "hi\n" to guest fd 1 via fd_write (iovec at 0 -> {ptr:32,len:3}, nwritten at 12)
const HELLO_BODY = [
  0x41, 0, 0x41, 32, 0x36, 2, 0, 0x41, 4, 0x41, 3, 0x36, 2, 0,
  0x41, 32, 0x41, 0xe8, 0x00, 0x36, 2, 0, 0x41, 33, 0x41, 0xe9, 0x00, 0x36, 2, 0, 0x41, 34, 0x41, 10, 0x36, 2, 0,
  0x41, 1, 0x41, 0, 0x41, 1, 0x41, 12, 0x10, 0, 0x1a,
];

const PLAIN = craftModule([]);
const NOSTART = craftModule([], [], null);
const REACTOR = craftModule([], [], "_initialize");

function instantiate(bytes: Uint8Array, wasi: WASI) {
  return new WebAssembly.Instance(new WebAssembly.Module(bytes), wasi.getImportObject());
}

describe("new WASI() option validation", () => {
  test("options must be an object", () => {
    expect(() => new WASI(42 as any)).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }));
    expect(() => new WASI("preview1" as any)).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }));
    expect(() => new WASI(null as any)).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }));
  });

  test("version is required and must be 'preview1' or 'unstable'", () => {
    expect(() => new WASI({} as any)).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }));
    expect(() => new WASI()).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }));
    expect(() => new WASI({ version: "bogus" } as any)).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }),
    );
    expect(() => new WASI({ version: 1 } as any)).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }));
    expect(() => new WASI({ version: "preview1" })).not.toThrow();
    expect(() => new WASI({ version: "unstable" })).not.toThrow();
  });

  test("args must be an array, env/preopens must be objects", () => {
    expect(() => new WASI({ version: "preview1", args: "x" } as any)).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
    );
    expect(() => new WASI({ version: "preview1", env: "x" } as any)).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
    );
    expect(() => new WASI({ version: "preview1", preopens: "x" } as any)).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
    );
  });

  test("stdin/stdout/stderr must be non-negative int32", () => {
    for (const k of ["stdin", "stdout", "stderr"] as const) {
      for (const bad of ["x", -1, 1.5, NaN, Infinity, -Infinity, 2 ** 31]) {
        expect(() => new WASI({ version: "preview1", [k]: bad } as any)).toThrow();
      }
      expect(() => new WASI({ version: "preview1", [k]: 0 } as any)).not.toThrow();
      expect(() => new WASI({ version: "preview1", [k]: 2 ** 31 - 1 } as any)).not.toThrow();
    }
  });

  test("returnOnExit must be boolean", () => {
    expect(() => new WASI({ version: "preview1", returnOnExit: 1 } as any)).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
    );
    expect(() => new WASI({ version: "preview1", returnOnExit: true })).not.toThrow();
    expect(() => new WASI({ version: "preview1", returnOnExit: false })).not.toThrow();
  });
});

describe("getImportObject()", () => {
  test("returns the wasiImport under the version's binding name", () => {
    const w1 = new WASI({ version: "preview1" });
    expect(typeof w1.getImportObject).toBe("function");
    const o1 = w1.getImportObject();
    expect(Object.keys(o1)).toEqual(["wasi_snapshot_preview1"]);
    expect(o1.wasi_snapshot_preview1).toBe(w1.wasiImport);

    const w2 = new WASI({ version: "unstable" });
    expect(Object.keys(w2.getImportObject())).toEqual(["wasi_unstable"]);
  });

  test("wasiImport exposes sock_accept", () => {
    const w = new WASI({ version: "preview1" });
    expect(typeof w.wasiImport.sock_accept).toBe("function");
  });
});

describe("start()", () => {
  test("returns the exit code (0 when _start returns normally)", () => {
    const w = new WASI({ version: "preview1" });
    const ret = w.start(instantiate(PLAIN, w));
    expect(ret).toBe(0);
  });

  test("returns the value passed to proc_exit when returnOnExit is true (default)", () => {
    // _start: proc_exit(7)
    const EXIT7 = craftModule([["proc_exit", "i"]], [0x41, 7, 0x10, 0, 0x1a]);
    const w = new WASI({ version: "preview1" });
    expect(w.start(instantiate(EXIT7, w))).toBe(7);
  });

  test("proc_exit terminates the host process when returnOnExit is false", async () => {
    const bytes = Array.from(craftModule([["proc_exit", "i"]], [0x41, 7, 0x10, 0, 0x1a]));
    const src = `
      import { WASI } from "node:wasi";
      const bytes = new Uint8Array(${JSON.stringify(bytes)});
      const w = new WASI({ version: "preview1", returnOnExit: false });
      w.start(new WebAssembly.Instance(new WebAssembly.Module(bytes), w.getImportObject()));
      console.log("UNREACHABLE");
    `;
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", src], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).not.toContain("UNREACHABLE");
    expect(exitCode).toBe(7);
  });

  test("throws ERR_INVALID_ARG_TYPE when _start is missing", () => {
    const w = new WASI({ version: "preview1" });
    expect(() => w.start(instantiate(NOSTART, w))).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }));
  });

  test("throws ERR_INVALID_ARG_TYPE when _initialize is present", () => {
    // a module exporting both _start and _initialize: start() must reject it
    const memory = new WebAssembly.Memory({ initial: 1 });
    const w = new WASI({ version: "preview1" });
    const fake = { exports: { memory, _start() {}, _initialize() {} } };
    expect(() => w.start(fake as any)).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }));
  });

  test("throws ERR_WASI_ALREADY_STARTED on second call", () => {
    const w = new WASI({ version: "preview1" });
    const i = instantiate(PLAIN, w);
    expect(w.start(i)).toBe(0);
    expect(() => w.start(i)).toThrow(expect.objectContaining({ code: "ERR_WASI_ALREADY_STARTED" }));
  });

  test("rejects a reactor module (one that exports _initialize)", () => {
    const w = new WASI({ version: "preview1" });
    expect(() => w.start(instantiate(REACTOR, w))).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }));
  });

  test("validates instance and instance.exports", () => {
    expect(() => new WASI({ version: "preview1" }).start("nope" as any)).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
    );
    expect(() => new WASI({ version: "preview1" }).start({} as any)).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
    );
    expect(() => new WASI({ version: "preview1" }).start({ exports: {} } as any)).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
    );
  });
});

describe("initialize()", () => {
  test("accepts a reactor module and calls _initialize", () => {
    const w = new WASI({ version: "preview1" });
    let called = 0;
    const memory = new WebAssembly.Memory({ initial: 1 });
    const fake = { exports: { memory, _initialize: () => void called++ } };
    expect(typeof w.initialize).toBe("function");
    expect(w.initialize(fake as any)).toBeUndefined();
    expect(called).toBe(1);
  });

  test("accepts a module with neither _start nor _initialize", () => {
    const w = new WASI({ version: "preview1" });
    expect(() => w.initialize(instantiate(NOSTART, w))).not.toThrow();
  });

  test("rejects a command module (one that exports _start)", () => {
    const w = new WASI({ version: "preview1" });
    expect(() => w.initialize(instantiate(PLAIN, w))).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
    );
  });

  test("throws ERR_WASI_ALREADY_STARTED on second call", () => {
    const w = new WASI({ version: "preview1" });
    const i = instantiate(REACTOR, w);
    w.initialize(i);
    expect(() => w.initialize(i)).toThrow(expect.objectContaining({ code: "ERR_WASI_ALREADY_STARTED" }));
    expect(() => w.start(i)).toThrow(expect.objectContaining({ code: "ERR_WASI_ALREADY_STARTED" }));
  });
});

test("args are coerced to strings", () => {
  const w = new WASI({ version: "preview1", args: [1, true, "x"] as any });
  // args_sizes_get writes count/byte-size; we just need it not to throw on non-strings.
  const memory = new WebAssembly.Memory({ initial: 1 });
  w.initialize({ exports: { memory } } as any);
  expect(() => w.wasiImport.args_sizes_get(0, 4)).not.toThrow();
  const view = new DataView(memory.buffer);
  expect(view.getUint32(0, true)).toBe(3);
});

describe("stdin/stdout/stderr fd options", () => {
  test("guest fd 1 writes go to the host fd passed as options.stdout", () => {
    using dir = tempDir("wasi-stdout-fd", {});
    const outPath = path.join(String(dir), "out.txt");
    const outFd = fs.openSync(outPath, "w");
    try {
      const w = new WASI({ version: "preview1", stdout: outFd });
      const HELLO = craftModule([["fd_write", "iiii"]], HELLO_BODY);
      w.start(instantiate(HELLO, w));
    } finally {
      fs.closeSync(outFd);
    }
    expect(fs.readFileSync(outPath, "utf8")).toBe("hi\n");
  });

  test("options.stdout is honored from a child process (nothing leaks to host stdout)", async () => {
    using dir = tempDir("wasi-stdout-fd-child", {});
    const outPath = path.join(String(dir), "out.txt");
    const src = `
      import { WASI } from "node:wasi";
      import * as fs from "node:fs";
      const bytes = new Uint8Array(${JSON.stringify(Array.from(craftModule([["fd_write", "iiii"]], HELLO_BODY)))});
      const outFd = fs.openSync(process.env.OUT_PATH, "w");
      const w = new WASI({ version: "preview1", stdout: outFd });
      w.start(new WebAssembly.Instance(new WebAssembly.Module(bytes), w.getImportObject()));
      fs.closeSync(outFd);
      console.error("CAPTURED=" + JSON.stringify(fs.readFileSync(process.env.OUT_PATH, "utf8")));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: { ...bunEnv, OUT_PATH: outPath },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain('CAPTURED="hi\\n"');
    expect(stdout).toBe("");
    expect(exitCode).toBe(0);
  });

  test("guest fd 0 reads come from the host fd passed as options.stdin", () => {
    using dir = tempDir("wasi-stdin-fd", { "in.txt": "abc" });
    const inFd = fs.openSync(path.join(String(dir), "in.txt"), "r");
    try {
      const w = new WASI({ version: "preview1", stdin: inFd });
      const memory = new WebAssembly.Memory({ initial: 1 });
      w.initialize({ exports: { memory } } as any);
      const view = new DataView(memory.buffer);
      // iovec at 0 -> {ptr:32, len:8}; nread at 16
      view.setUint32(0, 32, true);
      view.setUint32(4, 8, true);
      expect(w.wasiImport.fd_read(0, 0, 1, 16)).toBe(0);
      expect(view.getUint32(16, true)).toBe(3);
      expect(Buffer.from(memory.buffer, 32, 3).toString()).toBe("abc");
    } finally {
      fs.closeSync(inFd);
    }
  });

  test("guest fd 2 writes go to the host fd passed as options.stderr", () => {
    using dir = tempDir("wasi-stderr-fd", {});
    const errPath = path.join(String(dir), "err.txt");
    const errFd = fs.openSync(errPath, "w");
    try {
      const w = new WASI({ version: "preview1", stderr: errFd });
      const memory = new WebAssembly.Memory({ initial: 1 });
      w.initialize({ exports: { memory } } as any);
      const view = new DataView(memory.buffer);
      Buffer.from(memory.buffer).write("err!", 32);
      view.setUint32(0, 32, true);
      view.setUint32(4, 4, true);
      expect(w.wasiImport.fd_write(2, 0, 1, 16)).toBe(0);
      expect(view.getUint32(16, true)).toBe(4);
    } finally {
      fs.closeSync(errFd);
    }
    expect(fs.readFileSync(errPath, "utf8")).toBe("err!");
  });
});
