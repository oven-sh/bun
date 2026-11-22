// TEMPORARY PROBE, NOT FOR MERGE. Prints facts about operator new and operator delete on the macOS machines.
// Each line that starts with PROBE is a result. The tests pass whatever the results are.
import { test } from "bun:test";
import { bunEnv, bunExe, isASAN, isMacOS, nodeExe, tempDir } from "harness";
import { closeSync, openSync, readSync } from "node:fs";
import { release } from "node:os";
import { basename, join, resolve } from "node:path";

const say = (line: string) => console.log(`PROBE [${process.arch} darwin ${release()}] ${line}`);

// The header flags, the exported names and their offsets in the image, of a thin 64-bit Mach-O file.
export function readMachO(path: string): { flags: number; exports: string[]; offsets: Map<string, number> } {
  const fd = openSync(path, "r");
  try {
    const read = (offset: number, size: number) => {
      const buffer = Buffer.alloc(size);
      readSync(fd, buffer, 0, size, offset);
      return buffer;
    };
    const header = read(0, 32);
    if (header.readUInt32LE(0) !== 0xfeedfacf) throw new Error("not a thin 64-bit Mach-O file: " + path);
    const commands = read(32, header.readUInt32LE(20));
    let trie = Buffer.alloc(0);
    for (let at = 0, i = 0; i < header.readUInt32LE(16); i++, at += commands.readUInt32LE(at + 4)) {
      const command = commands.readUInt32LE(at);
      // LC_DYLD_EXPORTS_TRIE, or LC_DYLD_INFO(_ONLY) with export_off and export_size.
      if (command === 0x80000033) trie = read(commands.readUInt32LE(at + 8), commands.readUInt32LE(at + 12));
      else if ((command & 0x7fffffff) === 0x22)
        trie = read(commands.readUInt32LE(at + 40), commands.readUInt32LE(at + 44));
    }
    const exports: string[] = [];
    const offsets = new Map<string, number>();
    const uleb = (at: number): [number, number] => {
      let value = 0;
      for (let shift = 0; ; shift += 7) {
        const byte = trie[at++]!;
        value += (byte & 0x7f) * 2 ** shift;
        if (!(byte & 0x80)) return [value, at];
      }
    };
    const walk = (node: number, prefix: string) => {
      let [terminalSize, at] = uleb(node);
      if (terminalSize) {
        exports.push(prefix);
        // Flags, then the offset unless the export is of another image's symbol.
        const [flags, afterFlags] = uleb(at);
        if (!(flags & 0x8)) offsets.set(prefix, uleb(afterFlags)[0]);
      }
      at += terminalSize;
      for (let children = trie[at++]!; children > 0; children--) {
        const end = trie.indexOf(0, at);
        const label = trie.toString("latin1", at, end);
        const [child, next] = uleb(end + 1);
        at = next;
        walk(child, prefix + label);
      }
    };
    if (trie.length) walk(0, "");
    return { flags: header.readUInt32LE(24), exports, offsets };
  } finally {
    closeSync(fd);
  }
}

async function run(cmd: string[], env: Record<string, string | undefined> = {}, cwd?: string) {
  await using child = Bun.spawn({ cmd, env: { ...bunEnv, ...env }, cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  return { stdout, stderr, exitCode, signalCode: child.signalCode };
}

// What the "cache patch" lines of dyld say. Each is one place in the shared cache and the definition it now calls. The
// dyld of macOS 14 prints only these lines, and no names.
export function describePatches(lines: string[], offsets: Map<string, number>, arch: string): string[] {
  const said: string[] = [];
  // A place in an arm64e library can hold a signed pointer: the address is its low 47 bits.
  const patches = lines.flatMap(line => {
    const match = /cache patch: (0x[0-9A-Fa-f]+) = (0x[0-9A-Fa-f]+)/.exec(line);
    return match ? [{ place: BigInt(match[1]!), target: BigInt(match[2]!) & 0x7fffffffffffn }] : [];
  });
  const pageBits = arch === "arm64" ? 14n : 12n;
  const pageSize = 1n << pageBits;
  const targets = [...new Set(patches.map(patch => patch.target))];
  said.push(
    `cache patch lines: ${patches.length}, to ${targets.length} definitions, ` +
      `on ${new Set(patches.map(patch => patch.place >> pageBits)).size} pages of ${pageSize} bytes`,
  );
  // Which operators the definitions are. The linker can give operators with the same code one address.
  const kindsAt = new Map<bigint, Set<string>>();
  for (const [name, offset] of offsets) {
    if (!/^__Z[nd]/.test(name)) continue;
    if (!kindsAt.has(BigInt(offset))) kindsAt.set(BigInt(offset), new Set());
    kindsAt.get(BigInt(offset))!.add(name.startsWith("__Zn") ? "new" : "delete");
  }
  said.push(`the operators that the executable exports are at ${kindsAt.size} addresses`);
  // The executable is loaded at the page boundary that puts the most definitions on an exported operator.
  let base = 0n;
  let most = 0;
  for (const target of targets) {
    for (const offset of kindsAt.keys()) {
      const candidate = target - offset;
      if (candidate % pageSize !== 0n) continue;
      const fit = targets.filter(other => kindsAt.has(other - candidate)).length;
      if (fit > most) [base, most] = [candidate, fit];
    }
  }
  if (!most) return said;
  const kindOf = (target: bigint) => [...(kindsAt.get(target - base) ?? ["something else"])].sort().join(" and ");
  const count = (keys: string[]) => {
    const counts = new Map<string, number>();
    for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
    return [...counts]
      .sort()
      .map(([key, value]) => `${value} for ${key}`)
      .join(", ");
  };
  const kindsOfPage = new Map<bigint, Set<string>>();
  for (const { place, target } of patches) {
    const page = place >> pageBits;
    if (!kindsOfPage.has(page)) kindsOfPage.set(page, new Set());
    kindsOfPage.get(page)!.add(kindOf(target));
  }
  said.push(`definitions: ${count(targets.map(kindOf))}`);
  said.push(`places patched: ${count(patches.map(patch => kindOf(patch.target)))}`);
  said.push(`pages written: ${count([...kindsOfPage.values()].map(kinds => [...kinds].sort().join(" and ")))}`);
  return said;
}

test.skipIf(!isMacOS || isASAN)("PROBE: what the executable exports", () => {
  const { flags, exports } = readMachO(bunExe());
  const count = (prefix: string) => exports.filter(name => name.startsWith(prefix)).length;
  say(
    `executable: MH_WEAK_DEFINES ${flags & 0x8000 ? "set" : "not set"}, ${exports.length} exports, ` +
      `${count("__Zn")} operator new, ${count("__Zd")} operator delete`,
  );
});

test.skipIf(!isMacOS || isASAN)("PROBE: what dyld binds the operators to when the process starts", async () => {
  const { stderr, exitCode, signalCode } = await run([bunExe(), "-e", "0"], { DYLD_PRINT_BINDINGS: "1" });
  const lines = stderr.split("\n");
  const named = (pattern: RegExp) => [...new Set(lines.flatMap(line => pattern.exec(line)?.[1] ?? []))].sort();
  // Some versions of dyld print the name in quotes.
  const overridden = named(/found use of '?(__Z[nd][A-Za-z0-9_]*)'? in cache, need to override/);
  const lookedUp = named(/looking for weak-def symbol '?(__Z[nd][A-Za-z0-9_]*)'?/);
  say(`dyld printed ${lines.length} lines (exit ${exitCode}, signal ${signalCode})`);
  say(`operators that dyld looked up as weak definitions: ${lookedUp.length}`);
  say(
    `operators whose uses in the shared cache dyld patched: ${overridden.length}: ` +
      `${overridden.filter(name => name.startsWith("__Zn")).length} operator new, ` +
      `${overridden.filter(name => name.startsWith("__Zd")).length} operator delete`,
  );
  for (const line of describePatches(lines, readMachO(bunExe()).offsets, process.arch)) say(line);
  for (const name of ["__Znwm", "__ZdlPv", "__ZnwmSt19__type_descriptor_t"]) {
    const at = lines.findIndex(line => new RegExp(`looking for weak-def symbol '?${name}'?:?$`).test(line));
    const rest = at < 0 ? [] : lines.slice(at + 1);
    const next = rest.findIndex(line => line.includes("looking for weak-def symbol"));
    const answer = rest.slice(0, next < 0 ? 8 : Math.min(next, 8)).filter(line => /using|found use/.test(line));
    say(`${name}: ${answer.map(line => line.replace(/^dyld\[\d+\]:\s*/, "").trim()).join(" | ") || "no line"}`);
  }
});

// Image A replaces operator new and operator delete and exports them, as a library that links an allocator of its own
// does. HEADER=0: its blocks are malloc's. HEADER=16: each block has a header in front that only A knows.
const replacing = `
#include <cstdlib>
#include <new>
#include <node_api.h>
void* operator new(size_t size)
{
    void* block = malloc(size + HEADER);
    if (!block)
        abort();
    return static_cast<char*>(block) + HEADER;
}
void operator delete(void* block) noexcept
{
    if (block)
        free(static_cast<char*>(block) - HEADER);
}
void operator delete(void* block, size_t) noexcept { ::operator delete(block); }
NAPI_MODULE_INIT() { return exports; }
`;

// Image X, loaded after A, says where its operators are and releases what it allocates.
const later = `
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <ctime>
#include <dlfcn.h>
#include <new>
#include <node_api.h>
static const char* imageOf(void* function)
{
    Dl_info image;
    if (!dladdr(function, &image) || !image.dli_fname)
        return "no image";
    const char* slash = strrchr(image.dli_fname, '/');
    return slash ? slash + 1 : image.dli_fname;
}
NAPI_MODULE_INIT()
{
    void* (*allocate)(size_t) = &::operator new;
    void (*release)(void*) noexcept = &::operator delete;
    printf("operator new in %s, operator delete in %s", imageOf(reinterpret_cast<void*>(allocate)), imageOf(reinterpret_cast<void*>(release)));
    fflush(stdout);
    for (int i = 0; i < 1000; i++) {
        void* volatile block = allocate(32);
        release(block);
    }
    printf(", released 1000 blocks\\n");
    if (getenv("PROBE_PAIRS")) {
        const long pairs = 2000000;
        timespec start, end;
        clock_gettime(CLOCK_MONOTONIC, &start);
        for (long i = 0; i < pairs; i++) {
            void* volatile block = allocate(32);
            release(block);
        }
        clock_gettime(CLOCK_MONOTONIC, &end);
        printf("%.1f ns for a pair of operator new and operator delete\\n", ((end.tv_sec - start.tv_sec) * 1e9 + (end.tv_nsec - start.tv_nsec)) / pairs);
    }
    fflush(stdout);
    return exports;
}
`;

test.skipIf(!isMacOS || isASAN)(
  "PROBE: an image that is loaded after one that exports its own operator new",
  async () => {
    const compiler = process.env.CXX || Bun.which("c++") || Bun.which("clang++");
    if (!compiler) return say("pair: no C++ compiler");
    using dir = tempDir("operators-probe", { "replacing.cpp": replacing, "later.cpp": later });
    const folder = String(dir);
    const compile = async (source: string, output: string, flags: string[]) => {
      const result = await run(
        [
          compiler,
          "-std=c++17",
          "-O1",
          "-shared",
          "-fPIC",
          "-undefined",
          "dynamic_lookup",
          "-I" + resolve(import.meta.dir, "../../../../src/runtime/napi"),
          ...flags,
          source,
          "-o",
          output,
        ],
        {},
        folder,
      );
      if (result.exitCode !== 0) say(`pair: ${output} did not compile: ${result.stderr.slice(0, 600)}`);
      return result.exitCode === 0;
    };
    const built =
      (await compile("replacing.cpp", "malloc.node", ["-DHEADER=0"])) &&
      (await compile("replacing.cpp", "header.node", ["-DHEADER=16"])) &&
      (await compile("later.cpp", "later.node", []));
    if (!built) return;
    for (const image of ["malloc.node", "header.node", "later.node"]) {
      const { flags, exports } = readMachO(join(folder, image));
      say(
        `pair: ${image}: MH_WEAK_DEFINES ${flags & 0x8000 ? "set" : "not set"}, MH_BINDS_TO_WEAK ${flags & 0x10000 ? "set" : "not set"}, ` +
          `exports ${exports.filter(name => /^__Z[nd]/.test(name)).join(" ") || "no operator"}`,
      );
    }
    const node = nodeExe();
    const runtimes: [string, string | null][] = [
      ["bun", bunExe()],
      ["node", node],
    ];
    for (const [name, runtime] of runtimes) {
      if (!runtime) {
        say(`pair: ${name}: not on this machine`);
        continue;
      }
      if (name === "node") say(`pair: node is ${(await run([runtime, "--version"])).stdout.trim()}`);
      const alone = `require(${JSON.stringify(join(folder, "later.node"))});`;
      const times: string[] = [];
      for (let repeat = 0; repeat < 3; repeat++) {
        const { stdout } = await run([runtime, "-e", alone], { PROBE_PAIRS: "1" });
        times.push(/([0-9.]+) ns for a pair/.exec(stdout)?.[1] ?? "?");
      }
      say(`pair: ${name}, later.node alone: ${times.join(", ")} ns for a pair of operator new and operator delete`);
      for (const first of ["malloc.node", "header.node"]) {
        const script = `require(${JSON.stringify(join(folder, first))}); require(${JSON.stringify(join(folder, "later.node"))});`;
        const result = await run([runtime, "-e", script], { MallocDebugReport: "stderr" });
        const stderr = result.stderr
          .split("\n")
          .filter(line => /malloc|freed|abort|panic|error/i.test(line))
          .slice(0, 3)
          .join(" | ");
        say(
          `pair: ${name}, after ${basename(first)}: ${result.stdout.trim() || "no output"}; ` +
            `exit ${result.exitCode}, signal ${result.signalCode}${stderr ? `; stderr: ${stderr.slice(0, 400)}` : ""}`,
        );
      }
    }
  },
  120_000,
);
