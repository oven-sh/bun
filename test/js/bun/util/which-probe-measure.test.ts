// Temporary. It compares ways to ask "is this PATH candidate a file that I may execute" on the macOS CI machines:
// the answers for every file of every PATH directory, the cost per call for several kinds of target, and what
// `Bun.which` of this build does with descriptors free and with none left. The test fails on purpose so that CI
// prints the report. Remove this file and which-probe-measure-fixture.ts before the PR is ready.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isMacOS, libcPathForDlopen, tempDir } from "harness";
import { mkfifo } from "mkfifo";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { hostname, release, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { setup, yn } from "./which-probe-measure-fixture.ts";

const median = (values: number[]) => values.toSorted((a, b) => a - b)[values.length >> 1];
const spread = (values: number[]) => {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[0] > 0 ? (((sorted.at(-1)! - sorted[0]) / sorted[0]) * 100).toFixed(1) + "%" : "n/a";
};

// The size of `__TEXT,__text`, and the bytes of the functions of the probe, read from the Mach-O image of this build.
function machOReport(path: string, log: (line: string) => void) {
  const fd = openSync(path, "r");
  try {
    const read = (length: number, position: number) => {
      const buffer = Buffer.alloc(length);
      readSync(fd, buffer, 0, length, position);
      return buffer;
    };
    const head = read(32, 0);
    if (head.readUInt32LE(0) !== 0xfeedfacf) {
      log(`mach-o: ${path} is not a thin 64-bit image (magic ${head.readUInt32LE(0).toString(16)})`);
      return;
    }
    const commandCount = head.readUInt32LE(16);
    const commands = read(head.readUInt32LE(20), 32);
    const name16 = (at: number) => commands.toString("latin1", at, at + 16).replace(/\0.*$/, "");
    const sections: { segment: string; section: string; address: number; size: number; offset: number }[] = [];
    let symtab: { symoff: number; nsyms: number; stroff: number; strsize: number } | undefined;
    for (let at = 0, i = 0; i < commandCount; i++) {
      const command = commands.readUInt32LE(at);
      if (command === 0x19) {
        // LC_SEGMENT_64
        const count = commands.readUInt32LE(at + 64);
        for (let s = 0; s < count; s++) {
          const section = at + 72 + s * 80;
          sections.push({
            section: name16(section),
            segment: name16(section + 16),
            address: Number(commands.readBigUInt64LE(section + 32)),
            size: Number(commands.readBigUInt64LE(section + 40)),
            offset: commands.readUInt32LE(section + 48),
          });
        }
      } else if (command === 0x2) {
        // LC_SYMTAB
        symtab = {
          symoff: commands.readUInt32LE(at + 8),
          nsyms: commands.readUInt32LE(at + 12),
          stroff: commands.readUInt32LE(at + 16),
          strsize: commands.readUInt32LE(at + 20),
        };
      }
      at += commands.readUInt32LE(at + 4);
    }
    const text = sections.find(s => s.segment === "__TEXT" && s.section === "__text");
    log(`mach-o: __TEXT,__text ${text?.size} bytes; file ${fstatSync(fd).size} bytes; ${symtab?.nsyms} symbols`);
    if (!symtab || !text) return;

    const strings = read(symtab.strsize, symtab.stroff);
    const symbols = read(symtab.nsyms * 16, symtab.symoff);
    // The addresses of every symbol that a section defines, to find where a function ends.
    const addresses = new Float64Array(symtab.nsyms);
    let defined = 0;
    for (let i = 0; i < symtab.nsyms; i++) {
      const type = symbols[i * 16 + 4];
      if ((type & 0xe0) === 0 && (type & 0x0e) === 0x0e) {
        addresses[defined++] = Number(symbols.readBigUInt64LE(i * 16 + 8));
      }
    }
    const sorted = addresses.subarray(0, defined).sort();
    const endOf = (address: number) => {
      let low = 0;
      let high = sorted.length;
      while (low < high) {
        const middle = (low + high) >> 1;
        if (sorted[middle] <= address) low = middle + 1;
        else high = middle;
      }
      return low < sorted.length ? sorted[low] : address;
    };
    for (const [needle, limit] of [
      ["\0_is_executable_file\0", 1],
      ["isExecutableFileByPath", 1],
      ["is_executable_file_path", 3],
    ] as const) {
      const found: string[] = [];
      for (let from = 0; found.length < limit;) {
        const hit = strings.indexOf(needle, from, "latin1");
        if (hit === -1) break;
        from = hit + needle.length;
        const start = needle.startsWith("\0") ? hit + 1 : strings.lastIndexOf(0, hit) + 1;
        const name = strings.toString("latin1", start, strings.indexOf(0, start));
        for (let i = 0; i < symtab.nsyms; i++) {
          const type = symbols[i * 16 + 4];
          if (symbols.readUInt32LE(i * 16) !== start || (type & 0xe0) !== 0 || (type & 0x0e) !== 0x0e) continue;
          const address = Number(symbols.readBigUInt64LE(i * 16 + 8));
          const size = endOf(address) - address;
          const bytes = read(Math.min(size, 400), text.offset + (address - text.address));
          found.push(`${name} size=${size} bytes=${bytes.toString("hex")}`);
          break;
        }
      }
      log(`mach-o: ${JSON.stringify(needle.replaceAll("\0", ""))}: ${found.length ? found.join(" | ") : "no symbol"}`);
    }
  } finally {
    closeSync(fd);
  }
}

test.skipIf(!isMacOS && !(isLinux && process.env.WHICH_PROBE_MEASURE_ON_LINUX))(
  "report: ways to ask whether a PATH candidate is executable",
  async () => {
    const { loadErrors, cString, probeAll, shapes, measure } = setup(libcPathForDlopen());
    const lines: string[] = [];
    const log = (line: string) => lines.push("MEASURE " + line);
    const run = (cmd: string, args: string[]) => {
      try {
        const { stdout, stderr } = spawnSync(cmd, args, { encoding: "utf8" });
        return (stdout + stderr).trim().replace(/\s+/g, " ").slice(0, 200);
      } catch (error) {
        return String(error);
      }
    };

    const productVersion = isMacOS ? run("sw_vers", ["-productVersion"]) : "";
    log(
      `system: macOS ${productVersion} darwin ${release()} ${process.arch} host=${hostname()} uid=${process.getuid!()} euid=${process.geteuid!()} user=${userInfo().username} bun=${Bun.version} ${Bun.revision.slice(0, 10)}`,
    );
    if (isMacOS) {
      log(
        `csrutil: ${run("/usr/bin/csrutil", ["status"])}; system extensions: ${run("/usr/bin/systemextensionsctl", ["list"])}`,
      );
    }
    log(`reply for ${process.execPath}: ${JSON.stringify(probeAll(process.execPath))}`);
    if (loadErrors.length) log("symbols that did not load: " + loadErrors.join("; "));
    if (isMacOS) {
      try {
        machOReport(process.execPath, log);
      } catch (error) {
        log(`mach-o: failed: ${error}`);
      }
    }

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
    const yes = { open: 0, attr: 0, stat: 0, which: 0, ownerBit: 0, classBit: 0 };
    const differs: Record<string, string[]> = { attr: [], stat: [], which: [], ownerBit: [], classBit: [] };
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
        const all = {
          open: answers.open.ok,
          attr: answers.attr.ok,
          stat: answers.stat.ok,
          which: answers.which,
          ownerBit,
          classBit,
        };
        for (const key of Object.keys(yes) as (keyof typeof yes)[]) if (all[key]) yes[key]++;
        for (const key of Object.keys(differs)) {
          if (all[key as keyof typeof all] !== all.open) {
            differs[key].push(`${path}(open=${yn(all.open)},errno=${answers.open.errno})`);
          }
        }
      }
    }
    log(
      `scan: ${total} paths in ${directories.length} directories; executable by open(O_EXEC) ${yes.open}, Bun.which ${yes.which}, getattrlist ${yes.attr}, stat+faccessat ${yes.stat}, owner bit ${yes.ownerBit}, class bit ${yes.classBit}`,
    );
    log(
      "scan: differs from open(O_EXEC): " +
        Object.keys(differs)
          .map(
            key =>
              `${key} ${differs[key].length}${differs[key].length ? " [" + differs[key].slice(0, 3).join(" ") + "]" : ""}`,
          )
          .join("; "),
    );

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
      "walk/p10/tool": "#!/bin/sh\n",
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
      ["walk/p10/tool", 0o755],
    ] as const) {
      chmodSync(at(name), mode);
    }
    const walkPath: string[] = [];
    for (let i = 1; i <= 12; i++) {
      mkdirSync(at(`walk/p${i}`), { recursive: true });
      walkPath.push(at(`walk/p${i}`));
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
      const answers = probeAll(name === "" ? "" : at(name));
      table.push(
        `${name || '""'}=${yn(answers.open.ok)}${yn(answers.attr.ok)}${yn(answers.stat.ok)}${yn(answers.which)}`,
      );
      if (
        answers.open.ok !== answers.attr.ok ||
        answers.open.ok !== answers.stat.ok ||
        answers.open.ok !== answers.which
      ) {
        fixtureDiffers.push(
          `${name}: open=${yn(answers.open.ok)}(errno ${answers.open.errno}) attr=${yn(answers.attr.ok)}(errno ${answers.attr.errno}) stat=${yn(answers.stat.ok)}(errno ${answers.stat.errno}) which=${yn(answers.which)}`,
        );
      }
    }
    log(`acl: ${acl.join(", ")}`);
    log(`fixtures (open, getattrlist, stat+faccessat, Bun.which): ${table.join(" ")}`);
    log(`fixtures: ${fixtures.length}; answers that differ: ${fixtureDiffers.length}: ${fixtureDiffers.join("; ")}`);

    // 3. The same questions with no descriptor left, and the system calls of one `Bun.which` of a name.
    {
      await using proc = Bun.spawn({
        cmd: [
          "/bin/sh",
          "-c",
          'ulimit -n 64 && exec "$@"',
          "sh",
          bunExe(),
          join(import.meta.dir, "which-probe-measure-fixture.ts"),
        ],
        env: {
          ...bunEnv,
          LIBC: libcPathForDlopen(),
          BASE: base,
          FIXTURES: JSON.stringify(fixtures),
          WALK_PATH: walkPath.join(":"),
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      let parsed: any;
      try {
        parsed = JSON.parse(stdout);
      } catch {}
      if (!parsed) {
        log(
          `no descriptor left: exit=${exitCode} stdout=${stdout.trim().slice(0, 300)} stderr=${stderr.trim().slice(0, 300)}`,
        );
      } else {
        const { held, calls, free, atLimit } = parsed;
        const show = (answers: Record<string, string>) =>
          Object.entries(answers)
            .map(([name, answer]) => `${name}=${answer}`)
            .join(" ");
        log(`limit: ${held} descriptors held; per fixture (open, stat+faccessat, Bun.which)`);
        log(`limit: descriptors free: ${show(free.answers)}`);
        log(`limit: no descriptor left: ${show(atLimit.answers)}`);
        log(
          `limit: Bun.which differs from its answer with descriptors free: ${
            Object.keys(free.answers)
              .filter(name => free.answers[name][2] !== atLimit.answers[name][2])
              .join(", ") || "none"
          }`,
        );
        log(
          `walk: Bun.which("tool") with the command in the 10th of 12 PATH directories, ${calls} calls: descriptors free: found ${free.walk.found}, ${free.walk.syscallsPerCall} system calls per call (empty PATH: ${free.emptyPathWalk.syscallsPerCall}); no descriptor left: found ${atLimit.walk.found}, ${atLimit.walk.syscallsPerCall} per call (empty PATH: ${atLimit.emptyPathWalk.syscallsPerCall})`,
        );
      }
    }
    chmodSync(at("locked"), 0o755);
    if (isMacOS) {
      for (const name of ["acl-deny-readattr", "acl-deny-execute", "acl-allow-execute"]) {
        spawnSync("/bin/chmod", ["-N", at(name)]);
      }
    }

    // 4. The cost of one call of each way to ask, for several targets.
    const homebrew = ["/opt/homebrew/bin/brew", "/usr/local/bin/brew", "/opt/homebrew/bin/git", "/usr/local/bin/git"];
    const missing = join(dirname(process.execPath), "no-such-command-for-which-probe");
    const names = Object.keys(shapes);
    const costs = (label: string, path: string, shapeNames: string[], rounds: number, calls: number) => {
      if (path === "" || (label.startsWith("hit") && !existsSync(path))) {
        log(`cost ${label}: not on this machine`);
        return;
      }
      const p = cString(path);
      const samples: Record<string, { ns: number[]; instructions: number[]; syscalls: number[] }> = {};
      for (const name of shapeNames) {
        samples[name] = { ns: [], instructions: [], syscalls: [] };
        measure(shapes[name], p, path, 500);
      }
      for (let round = 0; round < rounds; round++) {
        for (const name of shapeNames) {
          const result = measure(shapes[name], p, path, calls);
          samples[name].ns.push(result.ns);
          if (result.instructions !== null) samples[name].instructions.push(result.instructions);
          if (result.syscalls !== null) samples[name].syscalls.push(result.syscalls);
        }
      }
      const cells = shapeNames.map(name => {
        const { ns, instructions, syscalls } = samples[name];
        const counted = instructions.length && median(instructions) > 0;
        return (
          `${name}=` +
          (counted ? `${Math.round(median(instructions))}i(${spread(instructions)})/` : "") +
          `${Math.round(median(ns))}ns(${spread(ns)})` +
          (syscalls.length ? `/${median(syscalls).toFixed(2)}sc` : "")
        );
      });
      log(`cost ${label} (${path.split("/").length - 1} components, ${rounds}x${calls}): ${cells.join(" ")}`);
    };
    // The bound for this build: `Bun.which` beside the raw calls, for a found command and for a missing one.
    costs("bound hit bun itself", process.execPath, ["Bun.which", "open+close", "ffi"], 7, 20_000);
    costs("bound miss beside bun", missing, ["Bun.which", "open+close", "ffi"], 7, 20_000);
    for (const [label, path] of [
      ["hit /bin/ls", "/bin/ls"],
      ["hit /usr/bin/git", "/usr/bin/git"],
      ["hit homebrew", homebrew.find(path => existsSync(path)) ?? ""],
      ["hit tmp script", at("exec")],
      ["hit node_modules/.bin symlink", at("node_modules/.bin/tool")],
      ["hit bun itself", process.execPath],
      ["miss /usr/bin", "/usr/bin/no-such-command-for-which-probe"],
      ["miss tmp 10 directories down", at("d1/d2/d3/d4/d5/d6/d7/d8/d9/d10/no-such-command")],
    ] as const) {
      costs(label, path, names, 5, 3_000);
    }
    log("cost: median over interleaved rounds (spread); i = instructions retired, sc = BSD system calls, per call");

    console.log(lines.join("\n"));
    expect(lines.length).toBe(-1);
  },
  300_000,
);
