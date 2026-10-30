// Temporary. It compares the old probe of a PATH candidate, open(O_EXEC) and close, with the new one, one getattrlist
// call, on the macOS CI machines: the answers for every file of every PATH directory, and the cost per call. The test
// fails on purpose so that CI prints the report. Remove this file before the PR is ready.
import { dlopen, ptr, read } from "bun:ffi";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isMacOS, libcPathForDlopen, tempDir } from "harness";
import { mkfifo } from "mkfifo";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readdirSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { release, userInfo } from "node:os";
import { dirname, join } from "node:path";

// The Linux column is a stand-in, to run the script where there is no Mac: O_PATH for O_EXEC, and no getattrlist.
const O_PROBE = isMacOS ? 0x40000000 | 0x01000000 | 0x0004 | 0x20000 : 0o10000000 | 0o2000000;
const AT_FDCWD = isMacOS ? -2 : -100;
const AT_EACCESS = isMacOS ? 0x0010 : 0x200;
const ATTR_CMN_OBJTYPE = 0x00000008;
const ATTR_CMN_USERACCESS = 0x00200000;
const VREG = 1;
const X_OK = 1;
const REPLY_SIZE = 12;

const loadErrors: string[] = [];

function setup() {
  function tryLoad(symbols: Record<string, { args: string[]; returns: string }>): any {
    try {
      return dlopen(libcPathForDlopen(), symbols as any).symbols;
    } catch (error) {
      loadErrors.push(String(error));
      return {};
    }
  }

  function load() {
    const lib = {
      ...dlopen(libcPathForDlopen(), {
        open: { args: ["ptr", "i32"], returns: "i32" },
        close: { args: ["i32"], returns: "i32" },
        faccessat: { args: ["i32", "ptr", "i32", "i32"], returns: "i32" },
        getpid: { args: [], returns: "i32" },
        [isMacOS ? "__error" : "__errno_location"]: { args: [], returns: "ptr" },
      } as any).symbols,
      ...(isMacOS ? tryLoad({ getattrlist: { args: ["ptr", "ptr", "ptr", "usize", "u32"], returns: "i32" } }) : {}),
      ...(isMacOS ? tryLoad({ proc_pid_rusage: { args: ["i32", "i32", "ptr"], returns: "i32" } }) : {}),
    } as any;
    // The 64-bit-inode layout: `stat` on arm64, `stat$INODE64` on x64.
    const statName = isMacOS && process.arch === "x64" ? "stat$INODE64" : "stat";
    const stat = tryLoad({ [statName]: { args: ["ptr", "ptr"], returns: "i32" } })[statName] as
      ((path: number, out: number) => number) | undefined;
    const errnoLocation = lib.__error ?? lib.__errno_location;
    return { lib, stat, errno: () => read.i32(errnoLocation(), 0) };
  }

  const { lib, stat, errno } = load();

  // Each view is made over its own ArrayBuffer before `ptr` reads its address: the first `.buffer` of a small typed
  // array moves its bytes.
  const request = new Uint8Array(new ArrayBuffer(24));
  {
    const view = new DataView(request.buffer);
    view.setUint16(0, 5, true); // ATTR_BIT_MAP_COUNT
    view.setUint32(4, ATTR_CMN_OBJTYPE | ATTR_CMN_USERACCESS, true);
  }
  const reply = new Uint32Array(new ArrayBuffer(12));
  const statBuffer = new Uint8Array(new ArrayBuffer(512));
  const statView = new DataView(statBuffer.buffer);
  const requestPtr = ptr(request);
  const replyPtr = ptr(reply);
  const statPtr = ptr(statBuffer);

  const cString = (path: string) => {
    const bytes = new Uint8Array(new ArrayBuffer(Buffer.byteLength(path) + 1));
    new TextEncoder().encodeInto(path, bytes);
    return bytes;
  };

  type Answer = { ok: boolean; errno: number; detail?: string };

  function openProbe(path: number): Answer {
    const fd = lib.open(path, O_PROBE);
    if (fd < 0) return { ok: false, errno: errno() };
    lib.close(fd);
    return { ok: true, errno: 0 };
  }

  function attrProbe(path: number): Answer {
    if (!isMacOS) return statProbe(path);
    if (!lib.getattrlist) return { ok: false, errno: -1 };
    reply.fill(0);
    const rc = lib.getattrlist(path, requestPtr, replyPtr, REPLY_SIZE, 0);
    if (rc !== 0) return { ok: false, errno: errno() };
    const detail = `len=${reply[0]} type=${reply[1]} access=${reply[2]}`;
    return { ok: reply[1] === VREG && (reply[2] & X_OK) !== 0, errno: 0, detail };
  }

  function statProbe(path: number): Answer {
    if (!stat) return { ok: false, errno: -1 };
    statBuffer.fill(0);
    if (stat(path, statPtr) !== 0) return { ok: false, errno: errno() };
    // st_mode: offset 4 in the 64-bit-inode layout of macOS, offset 24 on Linux x64, 16 on Linux arm64.
    const mode = isMacOS ? statView.getUint16(4, true) : statView.getUint32(process.arch === "x64" ? 24 : 16, true);
    if ((mode & 0o170000) !== 0o100000) return { ok: false, errno: 0, detail: "mode=" + mode.toString(8) };
    if (lib.faccessat(AT_FDCWD, path, X_OK, AT_EACCESS) !== 0) return { ok: false, errno: errno() };
    return { ok: true, errno: 0 };
  }

  function probeAll(path: string) {
    const bytes = cString(path);
    const p = ptr(bytes);
    return { open: openProbe(p), attr: attrProbe(p), stat: statProbe(p) };
  }

  const show = (answer: Answer) => (answer.ok ? "yes" : answer.errno ? "no(errno " + answer.errno + ")" : "no");

  // The instructions that the whole process retired, from the counter `/usr/bin/time -l` reads.
  const rusage = new BigUint64Array(new ArrayBuffer(512));
  const rusagePtr = ptr(rusage);
  function counters() {
    if (!lib.proc_pid_rusage || lib.proc_pid_rusage(process.pid, 4, rusagePtr) !== 0) return null;
    // rusage_info_v4: ri_instructions at byte 248, ri_cycles at byte 256.
    return { instructions: Number(rusage[31]), cycles: Number(rusage[32]) };
  }

  function measure(fn: () => void, calls: number) {
    const before = counters();
    const start = Bun.nanoseconds();
    for (let i = 0; i < calls; i++) fn();
    const ns = (Bun.nanoseconds() - start) / calls;
    const after = counters();
    return {
      ns,
      instructions: before && after ? (after.instructions - before.instructions) / calls : null,
      cycles: before && after ? (after.cycles - before.cycles) / calls : null,
    };
  }

  return { lib, stat, cString, probeAll, show, measure, requestPtr, replyPtr, statPtr };
}

const median = (values: number[]) => values.toSorted((a, b) => a - b)[values.length >> 1];
const spread = (values: number[]) => {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[0] === 0 ? 0 : ((sorted.at(-1)! - sorted[0]) / sorted[0]) * 100;
};

test.skipIf(!isMacOS && !(isLinux && process.env.WHICH_PROBE_MEASURE_ON_LINUX))(
  "report: open(O_EXEC) against getattrlist for a PATH candidate",
  async () => {
    const { lib, stat, cString, probeAll, show, measure, requestPtr, replyPtr, statPtr } = setup();
    const lines: string[] = [];
    const log = (line: string) => lines.push("MEASURE " + line);

    const productVersion = isMacOS ? spawnSync("sw_vers", ["-productVersion"], { encoding: "utf8" }).stdout.trim() : "";
    log(
      `system: macOS ${productVersion} darwin ${release()} ${process.arch} uid=${process.getuid!()} euid=${process.geteuid!()} user=${userInfo().username} bun=${Bun.version} ${Bun.revision.slice(0, 10)}`,
    );

    // 1. The reply for a known executable.
    log(`reply for ${process.execPath}: ${JSON.stringify(probeAll(process.execPath))}`);
    if (loadErrors.length) log("symbols that did not load: " + loadErrors.join("; "));

    // 2. Every file of every PATH directory, and of some more directories.
    const directories = [
      ...new Set([
        ...(process.env.PATH ?? "").split(":").filter(Boolean),
        "/bin",
        "/usr/bin",
        "/sbin",
        "/usr/sbin",
        "/usr/local/bin",
        "/opt/homebrew/bin",
        "/usr/libexec",
        "/usr/lib",
        "/etc",
        "/usr/share/zsh",
        "/Applications",
        "/System/Library/CoreServices",
        dirname(process.execPath),
        process.cwd(),
      ]),
    ];
    let total = 0;
    const counts = { open: 0, attr: 0, stat: 0 };
    const differences: string[] = [];
    const errnos = new Map<string, number>();
    const scanned: string[] = [];
    for (const directory of directories) {
      let names: string[];
      try {
        names = readdirSync(directory);
      } catch {
        continue;
      }
      let inDirectory = 0;
      for (const name of names) {
        const path = join(directory, name);
        const answers = probeAll(path);
        total++;
        inDirectory++;
        for (const key of ["open", "attr", "stat"] as const) {
          if (answers[key].ok) counts[key]++;
          else errnos.set(`${key}:${answers[key].errno}`, (errnos.get(`${key}:${answers[key].errno}`) ?? 0) + 1);
        }
        if (answers.open.ok !== answers.attr.ok || answers.open.ok !== answers.stat.ok) {
          differences.push(
            `${path} open=${show(answers.open)} attr=${show(answers.attr)}${answers.attr.detail ? "[" + answers.attr.detail + "]" : ""} stat=${show(answers.stat)}`,
          );
        }
      }
      scanned.push(`${directory}=${inDirectory}`);
    }
    log(`scanned (directory=entries): ${scanned.join(" ")}`);
    log(
      `scan: ${total} paths; executable by open(O_EXEC) ${counts.open}, by getattrlist ${counts.attr}, by stat+faccessat ${counts.stat}; answers that differ: ${differences.length}`,
    );
    log(`scan errnos of "no": ${JSON.stringify(Object.fromEntries([...errnos].sort()))}`);
    for (const difference of differences.slice(0, 12)) log("differs: " + difference);

    // 3. Fixtures: one per kind of file and permission.
    using dir = tempDir("which-probe-measure", {
      "exec": "#!/bin/sh\n",
      "empty-exec": "",
      "plain": "#!/bin/sh\n",
      "execute-only": "#!/bin/sh\n",
      "owner-x": "#!/bin/sh\n",
      "group-x": "#!/bin/sh\n",
      "other-x": "#!/bin/sh\n",
      "acl-deny-readattr": "#!/bin/sh\n",
      "acl-deny-execute": "#!/bin/sh\n",
      "acl-allow-execute": "#!/bin/sh\n",
      "folder/inside": "#!/bin/sh\n",
      "locked/inside": "#!/bin/sh\n",
    });
    const base = String(dir);
    const at = (name: string) => join(base, name);
    chmodSync(at("exec"), 0o755);
    chmodSync(at("empty-exec"), 0o755);
    chmodSync(at("plain"), 0o644);
    chmodSync(at("execute-only"), 0o111);
    chmodSync(at("owner-x"), 0o100);
    chmodSync(at("group-x"), 0o010);
    chmodSync(at("other-x"), 0o001);
    chmodSync(at("acl-deny-readattr"), 0o755);
    chmodSync(at("acl-deny-execute"), 0o755);
    chmodSync(at("acl-allow-execute"), 0o644);
    chmodSync(at("folder/inside"), 0o755);
    chmodSync(at("locked/inside"), 0o755);
    symlinkSync("exec", at("link"));
    symlinkSync("missing", at("dangling-link"));
    symlinkSync("folder", at("link-to-folder"));
    symlinkSync("plain", at("link-to-plain"));
    mkfifo(at("fifo"), 0o755);
    mkdirSync(at("app.app"), { mode: 0o755 });
    using listener = Bun.listen({ unix: at("socket"), socket: { data() {} } });
    chmodSync(at("socket"), 0o755);
    const acl: string[] = [];
    if (isMacOS) {
      for (const [entry, name] of [
        ["everyone deny readattr", "acl-deny-readattr"],
        ["everyone deny execute", "acl-deny-execute"],
        [`${userInfo().username} allow execute`, "acl-allow-execute"],
      ]) {
        const { status, stderr } = spawnSync("/bin/chmod", ["+a", entry, at(name)], { encoding: "utf8" });
        acl.push(`${name}:${status === 0 ? "set" : "failed " + stderr.trim()}`);
      }
    }
    log(`acl: ${acl.join(", ")}`);
    chmodSync(at("locked"), 0o000);
    const fixtures = [
      "exec",
      "empty-exec",
      "plain",
      "execute-only",
      "owner-x",
      "group-x",
      "other-x",
      "acl-deny-readattr",
      "acl-deny-execute",
      "acl-allow-execute",
      "folder",
      "folder/inside",
      "folder/inside/",
      "exec/",
      "locked/inside",
      "link",
      "dangling-link",
      "link-to-folder",
      "link-to-plain",
      "fifo",
      "socket",
      "app.app",
      "missing",
      "",
    ];
    let fixtureDifferences = 0;
    for (const name of fixtures) {
      const path = name === "" ? "" : at(name);
      const answers = probeAll(path);
      const differs = answers.open.ok !== answers.attr.ok || answers.open.ok !== answers.stat.ok;
      if (differs) fixtureDifferences++;
      let mode = "";
      try {
        mode = (statSync(path).mode & 0o7777).toString(8);
      } catch {}
      log(
        `fixture ${JSON.stringify(name)} mode=${mode}: open=${show(answers.open)} attr=${show(answers.attr)}${answers.attr.detail ? "[" + answers.attr.detail + "]" : ""} stat=${show(answers.stat)} which=${JSON.stringify(Bun.which(path, { PATH: "" }) !== null)}${differs ? "  <-- DIFFERS" : ""}`,
      );
    }
    chmodSync(at("locked"), 0o755);
    if (isMacOS) {
      for (const name of ["acl-deny-readattr", "acl-deny-execute", "acl-allow-execute"]) {
        spawnSync("/bin/chmod", ["-N", at(name)]);
      }
    }
    log(`fixtures: ${fixtures.length}; answers that differ: ${fixtureDifferences}`);

    // 4. The same probes with no descriptor left.
    writeFileSync(
      at("limit.ts"),
      `
      import { dlopen, ptr, read } from "bun:ffi";
      import { openSync, closeSync } from "node:fs";
      const isMacOS = process.platform === "darwin";
      const lib = dlopen(process.env.LIBC!, {
        open: { args: ["ptr", "i32"], returns: "i32" },
        close: { args: ["i32"], returns: "i32" },
        [isMacOS ? "__error" : "__errno_location"]: { args: [], returns: "ptr" },
        ...(isMacOS ? { getattrlist: { args: ["ptr", "ptr", "ptr", "usize", "u32"], returns: "i32" } } : {}),
      } as any).symbols as any;
      const errno = () => read.i32((lib.__error ?? lib.__errno_location)(), 0);
      const request = new Uint8Array(new ArrayBuffer(24));
      new DataView(request.buffer).setUint16(0, 5, true);
      new DataView(request.buffer).setUint32(4, ${ATTR_CMN_OBJTYPE | ATTR_CMN_USERACCESS}, true);
      const reply = new Uint32Array(new ArrayBuffer(12));
      const path = new Uint8Array(new ArrayBuffer(Buffer.byteLength(process.env.TARGET!) + 1));
      new TextEncoder().encodeInto(process.env.TARGET!, path);
      const probes = () => {
        const fd = lib.open(ptr(path), ${O_PROBE});
        const open = fd < 0 ? "no(errno " + errno() + ")" : (lib.close(fd), "yes");
        let attr = "n/a";
        if (isMacOS) {
          reply.fill(0);
          const rc = lib.getattrlist(ptr(path), ptr(request), ptr(reply), 12, 0);
          attr = rc !== 0 ? "no(errno " + errno() + ")" : reply[1] === 1 && (reply[2] & 1) !== 0 ? "yes" : "no";
        }
        return { open, attr, which: Bun.which(process.env.TARGET!, { PATH: "" }) !== null };
      };
      const free = probes();
      const held: number[] = [];
      try {
        for (;;) held.push(openSync("/dev/null", "r"));
      } catch {}
      const atLimit = probes();
      for (const fd of held) closeSync(fd);
      console.log(JSON.stringify({ held: held.length, free, atLimit }));
      `,
    );
    {
      await using proc = Bun.spawn({
        cmd: ["/bin/sh", "-c", 'ulimit -n 64 && exec "$@"', "sh", bunExe(), at("limit.ts")],
        env: { ...bunEnv, LIBC: libcPathForDlopen(), TARGET: at("exec") },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      log(`no descriptor left: ${stdout.trim()} exit=${exitCode} ${stderr.trim().slice(0, 300)}`);
    }

    // 5. The cost of one probe: a hit (an executable) and a miss (a name that does not exist).
    const hit = cString(process.execPath);
    const miss = cString(join(dirname(process.execPath), "no-such-command-for-which-probe"));
    const shapes: Record<string, (path: number) => void> = {
      "open+close": path => {
        const fd = lib.open(path, O_PROBE);
        if (fd >= 0) lib.close(fd);
      },
      "getattrlist": path => {
        if (lib.getattrlist) lib.getattrlist(path, requestPtr, replyPtr, REPLY_SIZE, 0);
      },
      "stat+faccessat": path => {
        if (stat && stat(path, statPtr) === 0) lib.faccessat(AT_FDCWD, path, X_OK, AT_EACCESS);
      },
      // What two and one calls through bun:ffi cost with no system call to speak of.
      "ffi x2": () => {
        lib.getpid();
        lib.getpid();
      },
      "ffi x1": () => {
        lib.getpid();
      },
    };
    const calls = 20_000;
    const rounds = 7;
    for (const [label, bytes] of [
      ["hit", hit],
      ["miss", miss],
    ] as const) {
      const p = ptr(bytes);
      const samples: Record<string, { ns: number[]; instructions: number[]; cycles: number[] }> = {};
      for (const name of Object.keys(shapes)) samples[name] = { ns: [], instructions: [], cycles: [] };
      for (const name of Object.keys(shapes)) measure(() => shapes[name](p), 2_000);
      for (let round = 0; round < rounds; round++) {
        for (const name of Object.keys(shapes)) {
          const result = measure(() => shapes[name](p), calls);
          samples[name].ns.push(result.ns);
          if (result.instructions !== null) samples[name].instructions.push(result.instructions);
          if (result.cycles !== null) samples[name].cycles.push(result.cycles);
        }
      }
      for (const name of Object.keys(shapes)) {
        const { ns, instructions, cycles } = samples[name];
        log(
          `cost ${label} ${name}: ` +
            (instructions.length
              ? `instructions/call median ${Math.round(median(instructions))} (spread ${spread(instructions).toFixed(1)}%), cycles/call median ${Math.round(median(cycles))}, `
              : "instructions n/a, ") +
            `ns/call median ${Math.round(median(ns))} (spread ${spread(ns).toFixed(1)}%) [${rounds} rounds x ${calls} calls]`,
        );
      }
    }

    console.log(lines.join("\n"));
    expect(lines.length).toBe(-1);
  },
  300_000,
);
