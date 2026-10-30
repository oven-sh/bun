// Temporary. It compares ways to ask "is this PATH candidate a file that I may execute" on the macOS CI machines:
// the answers for every file of every PATH directory, and the cost per call for several kinds of target. The test
// fails on purpose so that CI prints the report. Remove this file before the PR is ready.
import { dlopen, ptr, read } from "bun:ffi";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isMacOS, libcPathForDlopen, tempDir } from "harness";
import { mkfifo } from "mkfifo";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { release, userInfo } from "node:os";
import { dirname, join } from "node:path";

// The Linux column is a stand-in, to run the script where there is no Mac: O_PATH for O_EXEC, and no getattrlist.
const O_PROBE = isMacOS ? 0x40000000 | 0x01000000 | 0x0004 | 0x20000 : 0o10000000 | 0o2000000;
const AT_FDCWD = isMacOS ? -2 : -100;
const AT_EACCESS = isMacOS ? 0x0010 : 0x200;
const ATTR_CMN_OBJTYPE = 0x00000008;
const ATTR_CMN_OWNERID = 0x00008000;
const ATTR_CMN_GRPID = 0x00010000;
const ATTR_CMN_ACCESSMASK = 0x00020000;
const ATTR_CMN_USERACCESS = 0x00200000;
const VREG = 1;
const F_OK = 0;
const X_OK = 1;

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

  const lib = {
    ...dlopen(libcPathForDlopen(), {
      open: { args: ["ptr", "i32"], returns: "i32" },
      close: { args: ["i32"], returns: "i32" },
      access: { args: ["ptr", "i32"], returns: "i32" },
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
  const errno = () => read.i32(errnoLocation(), 0);

  // Each view is made over its own ArrayBuffer before `ptr` reads its address: the first `.buffer` of a small typed
  // array moves its bytes.
  const attrRequest = (attributes: number) => {
    const request = new Uint8Array(new ArrayBuffer(24));
    const view = new DataView(request.buffer);
    view.setUint16(0, 5, true); // ATTR_BIT_MAP_COUNT
    view.setUint32(4, attributes, true);
    return { request, address: ptr(request) };
  };
  const typeAndAccess = attrRequest(ATTR_CMN_OBJTYPE | ATTR_CMN_USERACCESS);
  const typeOnly = attrRequest(ATTR_CMN_OBJTYPE);
  const typeModeOwner = attrRequest(ATTR_CMN_OBJTYPE | ATTR_CMN_OWNERID | ATTR_CMN_GRPID | ATTR_CMN_ACCESSMASK);
  const reply = new Uint32Array(new ArrayBuffer(64));
  const replyPtr = ptr(reply);
  const statBuffer = new Uint8Array(new ArrayBuffer(512));
  const statView = new DataView(statBuffer.buffer);
  const statPtr = ptr(statBuffer);

  // `ptr` gives an address and no reference, so every path stays in this list until the test ends.
  const pinned: Uint8Array[] = [];
  const cString = (path: string) => {
    const bytes = new Uint8Array(new ArrayBuffer(Buffer.byteLength(path) + 1));
    new TextEncoder().encodeInto(path, bytes);
    pinned.push(bytes);
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
    const rc = lib.getattrlist(path, typeAndAccess.address, replyPtr, 12, 0);
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

  // One call of each way to ask, for the cost table.
  const shapes: Record<string, (path: number) => void> = {
    "open+close": path => {
      const fd = lib.open(path, O_PROBE);
      if (fd >= 0) lib.close(fd);
    },
    "attr(type+access)": path => {
      if (lib.getattrlist) lib.getattrlist(path, typeAndAccess.address, replyPtr, 12, 0);
    },
    "stat+eaccess(X)": path => {
      if (stat && stat(path, statPtr) === 0) lib.faccessat(AT_FDCWD, path, X_OK, AT_EACCESS);
    },
    "stat": path => {
      if (stat) stat(path, statPtr);
    },
    "attr(type)": path => {
      if (lib.getattrlist) lib.getattrlist(path, typeOnly.address, replyPtr, 8, 0);
    },
    "attr(type+mode+owner)": path => {
      if (lib.getattrlist) lib.getattrlist(path, typeModeOwner.address, replyPtr, 20, 0);
    },
    "eaccess(F)": path => {
      lib.faccessat(AT_FDCWD, path, F_OK, AT_EACCESS);
    },
    "eaccess(X)": path => {
      lib.faccessat(AT_FDCWD, path, X_OK, AT_EACCESS);
    },
    "access(X)": path => {
      lib.access(path, X_OK);
    },
    "ffi": () => {
      lib.getpid();
    },
  };

  // The instructions that the whole process retired, from the counter `/usr/bin/time -l` reads.
  const rusage = new BigUint64Array(new ArrayBuffer(512));
  const rusagePtr = ptr(rusage);
  function instructions() {
    if (!lib.proc_pid_rusage || lib.proc_pid_rusage(process.pid, 4, rusagePtr) !== 0) return null;
    // rusage_info_v4: ri_instructions at byte 248.
    return Number(rusage[31]);
  }

  function measure(fn: (path: number) => void, path: number, calls: number) {
    const before = instructions();
    const start = Bun.nanoseconds();
    for (let i = 0; i < calls; i++) fn(path);
    const ns = (Bun.nanoseconds() - start) / calls;
    const after = instructions();
    return { ns, instructions: before !== null && after !== null ? (after - before) / calls : null };
  }

  return { cString, probeAll, shapes, measure };
}

const median = (values: number[]) => values.toSorted((a, b) => a - b)[values.length >> 1];
const yn = (ok: boolean) => (ok ? "Y" : "n");

test.skipIf(!isMacOS && !(isLinux && process.env.WHICH_PROBE_MEASURE_ON_LINUX))(
  "report: ways to ask whether a PATH candidate is executable",
  async () => {
    const { cString, probeAll, shapes, measure } = setup();
    const lines: string[] = [];
    const log = (line: string) => lines.push("MEASURE " + line);
    const run = (cmd: string, args: string[]) => {
      try {
        const { stdout, stderr } = spawnSync(cmd, args, { encoding: "utf8" });
        return (stdout + stderr).trim().replace(/\s+/g, " ").slice(0, 260);
      } catch (error) {
        return String(error);
      }
    };

    const productVersion = isMacOS ? run("sw_vers", ["-productVersion"]) : "";
    log(
      `system: macOS ${productVersion} darwin ${release()} ${process.arch} uid=${process.getuid!()} euid=${process.geteuid!()} user=${userInfo().username} bun=${Bun.version} ${Bun.revision.slice(0, 10)}`,
    );
    if (isMacOS) {
      log(`csrutil: ${run("/usr/bin/csrutil", ["status"])}`);
      log(`system extensions: ${run("/usr/bin/systemextensionsctl", ["list"])}`);
    }
    log(`reply for ${process.execPath}: ${JSON.stringify(probeAll(process.execPath))}`);
    if (loadErrors.length) log("symbols that did not load: " + loadErrors.join("; "));

    // 1. Every file of every PATH directory, and of some more directories. Two more predicates read the mode bits
    // only: the owner bit (what the Linux probe reads), and the bit of the class that the user is in.
    const euid = process.geteuid!();
    const groups = new Set([process.getegid!(), ...process.getgroups!()]);
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
    const yes = { open: 0, attr: 0, stat: 0, ownerBit: 0, classBit: 0 };
    const differs: Record<string, string[]> = { attr: [], stat: [], ownerBit: [], classBit: [] };
    for (const directory of directories) {
      let names: string[];
      try {
        names = readdirSync(directory);
      } catch {
        continue;
      }
      for (const name of names) {
        const path = join(directory, name);
        const answers = probeAll(path);
        let ownerBit = false;
        let classBit = false;
        try {
          const st = statSync(path);
          if (st.isFile()) {
            ownerBit = (st.mode & 0o100) !== 0;
            classBit =
              euid === 0
                ? (st.mode & 0o111) !== 0
                : st.uid === euid
                  ? (st.mode & 0o100) !== 0
                  : groups.has(st.gid)
                    ? (st.mode & 0o010) !== 0
                    : (st.mode & 0o001) !== 0;
          }
        } catch {}
        total++;
        const all = { open: answers.open.ok, attr: answers.attr.ok, stat: answers.stat.ok, ownerBit, classBit };
        for (const key of Object.keys(yes) as (keyof typeof yes)[]) if (all[key]) yes[key]++;
        for (const key of Object.keys(differs)) {
          if (all[key as keyof typeof all] !== all.open) {
            differs[key].push(`${path}(open=${yn(all.open)},errno=${answers.open.errno})`);
          }
        }
      }
    }
    log(
      `scan: ${total} paths in ${directories.length} directories; executable by open(O_EXEC) ${yes.open}, getattrlist ${yes.attr}, stat+faccessat ${yes.stat}, owner bit ${yes.ownerBit}, class bit ${yes.classBit}`,
    );
    for (const key of Object.keys(differs)) {
      log(`scan: ${key} differs from open(O_EXEC) on ${differs[key].length}: ${differs[key].slice(0, 4).join(" ")}`);
    }

    // 2. Fixtures: one per kind of file and permission.
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
      "d1/d2/d3/d4/d5/d6/d7/d8/d9/d10/exec": "#!/bin/sh\n",
      "node_modules/pkg/bin/tool.js": "#!/usr/bin/env node\n",
      "node_modules/.bin/keep": "",
    });
    const base = realpathSync(String(dir));
    const at = (name: string) => join(base, name);
    for (const [name, mode] of [
      ["exec", 0o755],
      ["empty-exec", 0o755],
      ["plain", 0o644],
      ["execute-only", 0o111],
      ["owner-x", 0o100],
      ["group-x", 0o010],
      ["other-x", 0o001],
      ["acl-deny-readattr", 0o755],
      ["acl-deny-execute", 0o755],
      ["acl-allow-execute", 0o644],
      ["folder/inside", 0o755],
      ["locked/inside", 0o755],
      ["d1/d2/d3/d4/d5/d6/d7/d8/d9/d10/exec", 0o755],
      ["node_modules/pkg/bin/tool.js", 0o755],
    ] as const) {
      chmodSync(at(name), mode);
    }
    symlinkSync("exec", at("link"));
    symlinkSync("missing", at("dangling-link"));
    symlinkSync("folder", at("link-to-folder"));
    symlinkSync("plain", at("link-to-plain"));
    symlinkSync("../pkg/bin/tool.js", at("node_modules/.bin/tool"));
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
      "node_modules/.bin/tool",
      "fifo",
      "socket",
      "app.app",
      "missing",
      "",
    ];
    const table: string[] = [];
    const fixtureDiffers: string[] = [];
    for (const name of fixtures) {
      const path = name === "" ? "" : at(name);
      const answers = probeAll(path);
      const which = Bun.which(path, { PATH: "" }) !== null;
      table.push(`${name || '""'}=${yn(answers.open.ok)}${yn(answers.attr.ok)}${yn(answers.stat.ok)}${yn(which)}`);
      if (answers.open.ok !== answers.attr.ok || answers.open.ok !== answers.stat.ok) {
        fixtureDiffers.push(
          `${name}: open=${yn(answers.open.ok)}(errno ${answers.open.errno}) attr=${yn(answers.attr.ok)}(errno ${answers.attr.errno}${answers.attr.detail ? " " + answers.attr.detail : ""}) stat=${yn(answers.stat.ok)}(errno ${answers.stat.errno})`,
        );
      }
    }
    chmodSync(at("locked"), 0o755);
    if (isMacOS) {
      for (const name of ["acl-deny-readattr", "acl-deny-execute", "acl-allow-execute"]) {
        spawnSync("/bin/chmod", ["-N", at(name)]);
      }
    }
    log(`acl: ${acl.join(", ")}`);
    log(`fixtures (open, getattrlist, stat+faccessat, Bun.which): ${table.join(" ")}`);
    log(`fixtures: ${fixtures.length}; answers that differ: ${fixtureDiffers.length}: ${fixtureDiffers.join("; ")}`);

    // 3. The same probes with no descriptor left.
    writeFileSync(
      at("limit.ts"),
      `
      import { dlopen, ptr, read } from "bun:ffi";
      import { openSync, closeSync } from "node:fs";
      const isMacOS = process.platform === "darwin";
      const lib = dlopen(process.env.LIBC!, {
        open: { args: ["ptr", "i32"], returns: "i32" },
        close: { args: ["i32"], returns: "i32" },
        faccessat: { args: ["i32", "ptr", "i32", "i32"], returns: "i32" },
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
        const eaccess =
          lib.faccessat(${AT_FDCWD}, ptr(path), ${X_OK}, ${AT_EACCESS}) === 0 ? "yes" : "no(errno " + errno() + ")";
        return { open, attr, eaccess, which: Bun.which(process.env.TARGET!, { PATH: "" }) !== null };
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

    // 4. The cost of one call of each way to ask, for several targets.
    const homebrew = ["/opt/homebrew/bin/brew", "/usr/local/bin/brew", "/opt/homebrew/bin/git", "/usr/local/bin/git"];
    const targets: [label: string, path: string][] = [
      ["hit /bin/ls", "/bin/ls"],
      ["hit /usr/bin/true", "/usr/bin/true"],
      ["hit /usr/bin/git", "/usr/bin/git"],
      ["hit homebrew", homebrew.find(path => existsSync(path)) ?? ""],
      ["hit tmp script", at("exec")],
      ["hit tmp script 10 directories down", at("d1/d2/d3/d4/d5/d6/d7/d8/d9/d10/exec")],
      ["hit node_modules/.bin symlink", at("node_modules/.bin/tool")],
      ["hit bun itself", process.execPath],
      ["miss /usr/bin", "/usr/bin/no-such-command-for-which-probe"],
      ["miss tmp 10 directories down", at("d1/d2/d3/d4/d5/d6/d7/d8/d9/d10/no-such-command")],
    ];
    const calls = 3_000;
    const rounds = 5;
    const names = Object.keys(shapes);
    for (const [label, path] of targets) {
      if (path === "" || (label.startsWith("hit") && !existsSync(path))) {
        log(`cost ${label}: not on this machine`);
        continue;
      }
      const bytes = cString(path);
      const p = ptr(bytes);
      const samples: Record<string, { ns: number[]; instructions: number[] }> = {};
      for (const name of names) {
        samples[name] = { ns: [], instructions: [] };
        measure(shapes[name], p, 500);
      }
      for (let round = 0; round < rounds; round++) {
        for (const name of names) {
          const result = measure(shapes[name], p, calls);
          samples[name].ns.push(result.ns);
          if (result.instructions !== null) samples[name].instructions.push(result.instructions);
        }
      }
      const cells = names.map(name => {
        const { ns, instructions } = samples[name];
        return `${name}=${instructions.length ? Math.round(median(instructions)) + "i/" : ""}${Math.round(median(ns))}ns`;
      });
      log(`cost ${label} (${path.split("/").length - 1} components, ${path.length} bytes): ${cells.join(" ")}`);
    }
    log(`cost: median of ${rounds} interleaved rounds of ${calls} calls; i = instructions retired by the process`);

    console.log(lines.join("\n"));
    expect(lines.length).toBe(-1);
  },
  300_000,
);
