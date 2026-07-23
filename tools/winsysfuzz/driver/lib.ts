// Shared driver library: trace parsing, RVA symbolization, module
// classification, and a watchdogged runner around wsfrun.exe.

import { existsSync, mkdirSync, readdirSync, statSync, statfsSync } from "node:fs";
import { dirname, join } from "node:path";

export const here = dirname(import.meta.path);
export const toolRoot = join(here, "..");
export const buildDir = join(toolRoot, "build", "Release");
export const wsfrun = join(buildDir, "wsfrun.exe");
export const wsfsym = join(buildDir, "wsfsym.exe");

export interface Syscall {
  id: number;
  name: string;
  ret: string;
  category: string;
  args: { name: string; type: string; dir: string; opt: boolean }[];
}
export const manifest: Syscall[] = await Bun.file(join(here, "generated", "syscalls.gen.json")).json();

// The COORDINATE key for a record. The raw key is the syscall's immediate
// return address - but for a call bun makes THROUGH a Windows API wrapper
// that immediate caller sits inside kernelbase/ntdll (k:/n: key), so EVERY
// read/open/close in the process shared ONE wrapper-internal key, and the
// startup mask (the runner reads and opens files at startup) removed all of
// them from the fault surface. Key wrapped calls by the FIRST bun.exe frame
// behind the wrapper instead ("B:<rva>" - the true program callsite):
// fs.readFile's ReadFile and the module loader's ReadFile become distinct
// coordinates, the mask stays exact, and the trunk I/O paths are faultable.
// The runtime matches a B: rule against that same first-bun-frame.
export function coordKey(r: { key: string; rvas: string[] }): string {
  if ((r.key.startsWith("k:") || r.key.startsWith("n:")) && r.rvas.length && r.rvas[0] !== "0") {
    return "B:" + r.rvas[0];
  }
  return r.key;
}

export const nameOf = (id: number) => manifest[id]?.name ?? `sys#${id}`;
export const idOf = (name: string) => manifest.findIndex(s => s.name === name);

export const STATUS: Record<string, string> = {
  "0": "STATUS_SUCCESS",
  "103": "STATUS_PENDING",
  "102": "STATUS_TIMEOUT",
  "80000005": "STATUS_BUFFER_OVERFLOW",
  "8000001a": "STATUS_NO_MORE_ENTRIES",
  "c0000001": "STATUS_UNSUCCESSFUL",
  "c0000005": "STATUS_ACCESS_VIOLATION",
  "c0000008": "STATUS_INVALID_HANDLE",
  "c000000d": "STATUS_INVALID_PARAMETER",
  "c0000011": "STATUS_END_OF_FILE",
  "c0000017": "STATUS_NO_MEMORY",
  "c0000022": "STATUS_ACCESS_DENIED",
  "c0000023": "STATUS_BUFFER_TOO_SMALL",
  "c0000034": "STATUS_OBJECT_NAME_NOT_FOUND",
  "c0000035": "STATUS_OBJECT_NAME_COLLISION",
  "c000003a": "STATUS_OBJECT_PATH_NOT_FOUND",
  "c0000043": "STATUS_SHARING_VIOLATION",
  "c000007c": "STATUS_NO_TOKEN",
  "c000007f": "STATUS_DISK_FULL",
  "c000009a": "STATUS_INSUFFICIENT_RESOURCES",
  "c00000bb": "STATUS_NOT_SUPPORTED",
  "c0000185": "STATUS_IO_DEVICE_ERROR",
};
export const statusName = (h: string) => STATUS[h.toLowerCase()] ?? h;

// --- crash detection by output signature -------------------------------------
// bun installs its own crash handler: a segfault/panic/assertion prints a
// report and exits with an ordinary code, so an exit-code oracle NEVER sees
// bun crash. And under `bun test`, a crashing CHILD bun surfaces only as the
// parent's failed test. So a crash is detected by what the process WROTE.
// Ordered most- to least-specific; the first match names the crash.
const CRASH_SIGNATURES: { re: RegExp; kind: string }[] = [
  { re: /panic\([^)]*\): (Segmentation fault at address 0x[0-9a-fA-F]+)/, kind: "segfault" },
  { re: /panic\([^)]*\): (Illegal instruction at address 0x[0-9a-fA-F]+)/, kind: "illegal-instruction" },
  { re: /panic\([^)]*\): ([^\n]{0,120})/, kind: "panic" },
  { re: /(ASSERTION FAILED: [^\n]{0,120})/, kind: "jsc-assert" },
  { re: /(Assertion failed: [^\n]{0,140})/, kind: "c-assert" },
  { re: /(mimalloc: assertion failed[^\n]{0,120})/, kind: "mimalloc-assert" },
  { re: /(panic: [^\n]{0,120})/, kind: "rust-panic" },
  // OOM family: crash-on-OOM is by design and not a finding worth triage.
  // Recognized as its own kind so admission can drop it as a class.
  { re: /(RangeError: Out of memory[^\n]{0,80})/, kind: "oom" },
  { re: /((?:oh no: )?[^\n]{0,40}out of memory[^\n]{0,80})/i, kind: "oom" },
  { re: /((?:memory allocation of \d+ bytes failed|failed to allocate|Failed to allocate)[^\n]{0,80})/i, kind: "oom" },
  { re: /(oh no: Bun has crashed[^\n]{0,80})/, kind: "crash-banner" },
  // Self-verifying workloads print this when data flowed through WRONG
  // without any crash - the silent-corruption class garbage faults expose.
  { re: /(WSF-CORRUPTION: [^\n]{0,120})/, kind: "corruption" },
];
export interface CrashSig {
  kind: string;
  signature: string; // stable dedupe key: the matched line, addresses folded
  detail: string; // the raw matched text
  raw?: string; // identical to detail: the UNFOLDED text (index values, sizes)
  // Whose code faulted, from the report's own backtrace addresses. bun's
  // handler catches ANY in-process fault - even one on a system DLL's
  // private thread - so a signature alone doesn't blame bun. On x64 the
  // exe maps at 0x7FF6/0x7FF7... while system DLLs sit at 0x7FFC-0x7FFE...:
  // 'bun' = some frame in the exe (bun's code involved), 'system-module' =
  // every frame is a DLL (we sabotaged system code from inside), 'unknown'.
  boundary: "bun" | "system-module" | "unknown";
  frames: string[]; // the printed backtrace lines, for the card
}
export function detectCrash(stdout: string, stderr: string): CrashSig | null {
  // A crashing CHILD's report reaches us via the parent's test-failure
  // output with its newlines JSON-escaped ("panic: ...\n???:?:?: ...") -
  // unescape first, or the signature swallows the escaped backtrace and
  // the same crash gets two keys depending on which layer printed it.
  const text = (stderr + "\n" + stdout).replace(/\\n/g, "\n").replace(/\\t/g, "\t");
  // Anchor: a REAL crash comes with the handler's own trailer/backtrace
  // block. Test files DESCRIBE past crashes in comments and expected-error
  // strings ("abort the process with \`panic: ...\`") and the runner prints
  // failing-test source context - a bare panic-family line with no crash
  // anchor anywhere in the output is quoted text, not a crash.
  const hasCrashAnchor =
    /oh no: Bun has crashed|Bun v[0-9.]+.*(Windows|Linux|macOS)|panicked at |0x7[Ff][0-9A-Fa-f]{9,}|Crash report saved to|trace at |SIGSEGV|Segmentation fault|Illegal instruction/.test(text);
  for (const { re, kind } of CRASH_SIGNATURES) {
    const m = re.exec(text);
    if (m) {
      // Panic-family and assertion-family signatures are only crashes when
      // the real handler's anchor accompanies them (see hasCrashAnchor).
      if (!hasCrashAnchor && /panic|assert|unreachable|crash-banner/.test(kind)) continue;
      const detail = m[1].trim();
      // Fold volatile addresses/counts so identical crashes dedupe:
      // "Segmentation fault at address 0x24" keeps the low offset (a
      // struct-field null deref reads identically), thread ids and
      // pointer-sized addresses fold.
      // Fold volatile pointers so identical crashes dedupe - but keep
      // SENTINEL addresses their identity: all-F (a -1/INVALID_HANDLE used
      // as a pointer) and low offsets (a struct field off a null base) are
      // diagnostic, and folding them merged unrelated wild-pointer faults.
      // The crash handler prints a bun.report trace URL that ENCODES the
      // stack: it is the fingerprint. A folded heap address (0xPTR) makes
      // every wild-pointer segfault one key; the trace URL keeps distinct
      // crashes distinct. Use it as the signature when the report has one.
      const traceUrl = /https?:\/\/bun\.report\/[^\s\/]+\/([A-Za-z0-9_+\-\/=]+)/.exec(text);
      const signature = traceUrl ? `${kind}@trace:${traceUrl[1].slice(0, 100)}` : detail
        .replace(/0x[0-9a-fA-F]{9,}/g, m => (/^0x[fF]{9,}$/.test(m) ? "0xFFFF(-1)" : "0xPTR"))
        .replace(/\bthread \d+\b/g, "thread N")
        // fold Win32/errno codes: the same die-with-message site with a
        // different injected error code is the same finding
        .replace(/Win32Error\(\d+\)/g, "Win32Error(N)")
        .replace(/\b(errno|code:?) ?-?\d+\b/g, "$1 N")
        .replace(/\b\d{5,}\b/g, "N");
      // The handler's backtrace: lines like "???:?:?: 0x7ffc... in ??? (???)"
      // or "<file>:<line>:<col>: 0x7ff6... in <symbol> (bun-debug.exe)".
      // Keep the crash's own trace in EITHER form the handler prints: raw
      // address lines (0x7ff...) OR already-symbolized "path.rs:line: symbol"
      // lines / "at path:line:col" lines. A Rust panic in a child arrives
      // symbolized; requiring an address dropped its frames entirely.
      const traceLine = /^[^\n]*(0x7[Ff][0-9A-Fa-f]{10,}|\.rs:\d+|\.zig:\d+|panicked at |^\s+at .+:\d+)[^\n]*$/gm;
      const frames = [...text.matchAll(traceLine)]
        .map(x => x[0].trim())
        .filter(l => l.length > 3)
        .slice(0, 32);
      // The FAULTING frame is the top of the printed backtrace: a crash whose
      // top frame is a system DLL is that module's code faulting (often on
      // state we poisoned inside it), even when bun frames sit below - e.g.
      // mswsock!_WSAFDIsSet <- ... <- bun!accept. Only a top frame inside the
      // exe means bun's own code faulted.
      let boundary: CrashSig["boundary"] = "unknown";
      const isExe = (f: string) => /0x7[Ff][Ff][0-9AaBb]/.test(f) || /bun(-debug)?\.exe/i.test(f);
      const isDll = (f: string) => /0x7[Ff][Ff][C-Fc-f]/.test(f);
      if (frames.length) {
        const top = frames[0];
        if (isExe(top)) boundary = "bun";
        else if (isDll(top)) boundary = "system-module";
        else boundary = frames.some(isExe) ? "bun" : frames.some(isDll) ? "system-module" : "unknown";
      }
      // OOM is ignorable UNLESS the allocation could genuinely OOM because
      // it is LARGE - an absurd requested size means an unvalidated length
      // or runaway growth (a real bug), not an exhausted environment.
      let k = kind;
      // Debug-build-only: a debug bun reads certain assets live from the
      // source tree (release embeds them). "Failed to load '<src path>'" is
      // an asset the user's binary never reads from disk - not user-facing.
      // "Failed to load '<path>'": the debug build reads its bundled runtime
      // JS / internal modules live from the source and build trees (release
      // embeds them) - any such asset-load failure cannot exist for a user.
      if (/Failed to load '[^']*[\\/](src|build|codegen)[\\/][^']*'/.test(detail)) k = "debug-only";
      // Rust cfg(debug_assertions) panics with a release fallback: the debug
      // build panics on a fallible OS lookup where release returns a
      // sentinel (user_unique_id: "GetUserNameW failed" -> return 0). The
      // panic never exists in the binary users run.
      if (/GetUserNameW failed/.test(detail)) k = "debug-only";
      // hot_reloader's watcher error handler logs "Watcher crashed" and
      // panics ONLY under debug_assertions - release continues.
      if (/panic: Watcher crash\b/.test(detail)) k = "debug-only";
      // A tripped debug_assert!/ASSERT is NOT nothing: it is the debug build
      // stopping exactly where the release binary (asserts compiled out)
      // proceeds unprotected. Keep these as findings under their own kind
      // rather than discarding them as debug-only.
      if (/panic: assertion failed:|ASSERTION FAILED:/.test(detail) && !/is_absolute_windows/.test(detail)) k = "debug-assert";
      // --hot/--watch die-with-message: the reloader cannot function without
      // its watcher, so init/start failure routes to Output::panic by design
      // (hot_reloader.rs Failed to enable/start File Watcher). Not a bug.
      if (/Failed to (enable|start) File Watcher/.test(detail)) k = "intentional-fatal";
      // debug_assert!(is_absolute_windows(cwd)) in _join_abs_string_buf_windows
      // (resolve_path.rs) is a documented precondition compiled out of
      // release; a non-absolute cwd is only manufacturable by mangling the
      // OS's own returned path length - real Windows returns absolute cwds.
      if (/assertion failed: crate::is_absolute_windows\(cwd\)/.test(detail)) k = "debug-only";
      // The bake DevServer hashes its own exe's mtime into a debug-only
      // cache-bust key (guarded by IS_DEBUG) and panics if that stat fails:
      // "unhandled EINVAL: <bun>: ... (stat())" on the running binary.
      if (/unhandled [A-Z]+: .*bun-debug\.exe.*\(stat\(\)\)/.test(detail)) k = "debug-only";
      if (k === "oom") {
        const bytes = /memory allocation of (\d+) bytes failed/i.exec(text)?.[1];
        if (bytes && Number(bytes) >= 256 * 1024 * 1024) k = "oom-large";
      }
      return { kind: k, signature, detail, boundary, frames, raw: detail };
    }
  }
  return null;
}

// --- trace records -----------------------------------------------------------

export interface Rec {
  seq: number;
  tid: number;
  sys: number;
  status: string;
  key: string; // coordinate identity "<tag>:<hexrva>" (immediate return addr) - the schedule key
  rva: string; // first candidate bun.exe frame (display/attribution), "0" if none
  rvas: string[]; // candidate frames, nearest first
  frame0: string;
  fault: "" | "P" | "Q" | "M" | "D"; // pre / post / mangle / delay
  entryOnly: boolean;
  path?: string; // decoded NT path from an 'A' record (WSF_ARGS=1)
  detail?: string; // 'D' record: handle target, AFD ioctl, len/xfer (WSF_ARGS=1)
}

// Undo the runtime's UTF-16 escaping (\uXXXX) back to a JS string.
export function unescapePath(s: string): string {
  return s.replace(/\\u([0-9a-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}
export interface Trace {
  notes: string[];
  recs: Rec[];
  recCount: number; // total X/E records seen, even those not materialized
  bunBase: string;
  cleanEnd: boolean;
  attached: number;
  modules: { base: bigint; size: bigint; name: string }[]; // '# mod' map for o:-key naming
  termStacks: string[][]; // one 'T' record per traced process: terminating thread's bun.exe frame RVAs
  malformed?: string; // first malformed X line seen (truncated/interleaved write), if any
  leaks: string[]; // 'L' records: named handles still open at process exit ("<kind> <name-tail>")
  leaksByProc: string[][]; // the same, kept per traced process (one array per trace file)
}

// Name the module an absolute address (an 'o:' key or a frame) falls in.
export function moduleAt(t: Trace, addrHex: string): string {
  try {
    const a = BigInt("0x" + addrHex);
    for (const m of t.modules) if (a >= m.base && a < m.base + m.size) return `${m.name}+0x${(a - m.base).toString(16)}`;
  } catch {}
  return `o:${addrHex}`;
}

// Human name for a coordinate key: b:/k:/n: are self-describing, o: goes
// through the module map ("o:7ffcc836026b" -> "MSWSOCK.dll+0x1026b").
export function keyName(t: Trace, key: string): string {
  if (key.startsWith("b:")) return `bun+0x${key.slice(2)}`;
  if (key.startsWith("k:")) return `kernelbase+0x${key.slice(2)}`;
  if (key.startsWith("n:")) return `ntdll+0x${key.slice(2)}`;
  if (key.startsWith("o:")) return moduleAt(t, key.slice(2));
  return key;
}

// faultsOnly: materialize only records carrying a fault marker (still
// counting all). Injection runs need "did it fire, and where" - not a
// 200k-record array for a 20MB trace of a big test file.
export function parseTrace(text: string, faultsOnly = false): Trace {
  const t: Trace = { notes: [], recs: [], recCount: 0, bunBase: "0", cleanEnd: false, attached: 0, modules: [], termStacks: [], leaks: [], leaksByProc: [], malformed: undefined };
  const bySeq = new Map<number, Rec>();
  for (const line of text.split("\n")) {
    if (!line) continue;
    if (line.startsWith("#")) {
      t.notes.push(line);
      const md = /^# mod ([0-9a-f]+) ([0-9a-f]+) (.+)$/.exec(line);
      if (md) t.modules.push({ base: BigInt("0x" + md[1]), size: BigInt("0x" + md[2]), name: md[3] });
      const b = /^# base bun ([0-9a-f]+)/.exec(line);
      if (b) t.bunBase = b[1];
      if (line.startsWith("# end")) t.cleanEnd = true;
      const a = /^# attached (\d+)/.exec(line);
      if (a) t.attached = +a[1];
      continue;
    }
    const p = line.split(" ");
    if (p[0] === "X") {
      // 'X seq tid sys status key rvas [!fault]' = at least 7 fields. A
      // short line is a truncated/interleaved write (the runtime appends
      // per-thread); count it, report it once, never build a keyless
      // record from it.
      if (p.length < 7) {
        t.recCount++;
        if (!t.malformed) {
          t.malformed = line.slice(0, 200);
          console.error(`readTraceDir: malformed X record skipped: ${JSON.stringify(t.malformed)}`);
        }
        continue;
      }
      t.recCount++;
      const fault: Rec["fault"] =
        p[7] === "!P" ? "P" : p[7] === "!Q" ? "Q" : p[7] === "!M" ? "M" : p[7] === "!D" ? "D" : "";
      if (faultsOnly && !fault) continue;
      const rvas = p[6] === "0" || !p[6] ? [] : p[6].split(",");
      const rec: Rec = {
        seq: +p[1],
        tid: +p[2],
        sys: +p[3],
        status: p[4],
        key: p[5],
        rva: rvas[0] ?? "0",
        rvas,
        frame0: p[5],
        fault,
        entryOnly: false,
      };
      t.recs.push(rec);
      bySeq.set(rec.seq, rec);
    } else if (p[0] === "A") {
      // 'A <seq> <sysid> <escaped-path>': attaches to its X record by seq.
      const rec = bySeq.get(+p[1]);
      if (rec) rec.path = unescapePath(p.slice(3).join(" "));
    } else if (p[0] === "D") {
      // 'D <seq> <sysid> k=v ...': typed detail (handle target, ioctl, len).
      const rec = bySeq.get(+p[1]);
      if (rec) rec.detail = p.slice(3).join(" ");
    } else if (p[0] === "T") {
      // 'T <tid> <key> <rva,rva,...>': the terminating thread's stack. Even
      // when parsing faults-only we keep it - it is the crash's why.
      if (p[3] && p[3] !== "0") t.termStacks.push(p[3].split(","));
    } else if (p[0] === "L") {
      // 'L <kind> <handle> <name-tail>': a named handle still open at exit
      // - the leak set. Kept even under faultsOnly (it IS the leak oracle).
      if (p.length >= 4) t.leaks.push(`${p[1]} ${unescapePath(p.slice(3).join(" "))}`);
    } else if (p[0] === "E") {
      t.recCount++;
      if (faultsOnly) continue;
      t.recs.push({ seq: +p[1], tid: +p[2], sys: +p[3], status: "", key: p[4], rva: "0", rvas: [], frame0: p[4], fault: "", entryOnly: true });
    }
  }
  return t;
}

// --- symbolization + module classification ------------------------------------

export interface Sym {
  sym: string;
  file: string;
}

export async function symbolize(image: string, rvas: string[]): Promise<Map<string, Sym>> {
  const out = new Map<string, Sym>();
  const uniq = [...new Set(rvas.filter(v => v && v !== "0"))];
  if (!uniq.length) return out;
  const proc = Bun.spawn([wsfsym, image, "-"], { stdin: "pipe", stdout: "pipe", stderr: "ignore" });
  proc.stdin.write(uniq.map(v => v + "\n").join(""));
  proc.stdin.end();
  const symOut = await new Response(proc.stdout).text();
  await proc.exited;
  for (const line of symOut.split("\n")) {
    const [rva, sym, file] = line.split("\t");
    if (rva) out.set(rva.trim(), { sym: sym ?? "?", file: (file ?? "-").trim() });
  }
  return out;
}

export function classifySym(s: Sym | undefined): string {
  if (!s) return "unresolved";
  const f = s.file.toLowerCase().replace(/\\/g, "/");
  const sym = s.sym;
  if (f.includes("/vendor/libuv/") || /^uv[_A-Z]/.test(sym) || sym.startsWith("uv__")) return "libuv";
  if (
    f.includes("/vendor/webkit/") ||
    /^(JSC|WTF|Inspector|bmalloc|Gigacage|Bun::|WebCore)::/.test(sym) ||
    sym.startsWith("bmalloc") ||
    sym.startsWith("pas_") ||
    /^(virtual_query|virtual_reserve|virtual_release)/.test(sym)
  )
    return "webkit";
  if (f.includes("/mimalloc/") || /^_?mi_/.test(sym)) return "mimalloc";
  if (f.includes("/boringssl/") || /^(SSL_|CRYPTO_|EVP_|BN_|EC_|RSA_|bssl::)/.test(sym)) return "boringssl";
  if (f.includes("/cares/") || sym.startsWith("ares_")) return "c-ares";
  if (f.includes("/lolhtml/")) return "lolhtml";
  if (f.includes("/zlib/") || f.includes("/brotli/") || f.includes("/zstd/") || f.includes("/libdeflate/"))
    return "compression";
  if (f.includes("/vc/tools/msvc/") || /^(malloc|free|calloc|realloc)|_dbg(_nolock)?$/.test(sym))
    return "ucrt";
  if (f.includes("/rust/") && /\/library\/(std|core|alloc)\//.test(f)) return "rust-std";
  if (f.includes("/.cargo/registry/")) return "rust-crates";
  if (f.includes("/bun/src/")) return "bun-rust";
  if (sym === "?" || sym.startsWith("?(")) return "unresolved";
  return "other";
}

const weakModules = new Set(["other", "unresolved", "rust-std", "ucrt"]);
export function moduleOf(r: Rec, syms: Map<string, Sym>): string {
  let fallback = "unresolved";
  for (const rva of r.rvas) {
    const m = classifySym(syms.get(rva));
    if (!weakModules.has(m)) return m;
    if (fallback === "unresolved" && m !== "unresolved") fallback = m;
  }
  return fallback;
}

// --- watchdogged runner --------------------------------------------------------

export interface RunOpts {
  bun: string; // path to the bun binary under test
  args: string[]; // program + args
  workDir: string; // log/capture dir for this run
  // Target cwd. Defaults to a "cwd" subdir of workDir, NOT workDir itself:
  // a target that operates on relative paths (mkdir/watch/etc) must not do
  // so inside the directory the injected DLL is streaming trace logs into
  // and the driver is writing stdout/stderr files into - an fs-heavy
  // workload otherwise observes/collides with the harness's own writes
  // (recursive watchers over the log tree, self-generated change storms)
  // and its trace is no longer a picture of the program's own I/O.
  cwd?: string;
  timeoutMs: number;
  schedule?: string; // schedule file path -> inject mode
  env?: Record<string, string>;
}
export interface RunResult {
  outcome: "exit" | "hang";
  exitCode: number | null;
  ms: number;
  stdout: string;
  stderr: string;
  logPath: string | null;
  dir: string; // the run directory (holds parent + child traces)
  crash: boolean; // NTSTATUS-style exit
  crashSig: CrashSig | null; // crash detected by output signature (bun's handler masks exit codes)
}

// The toolkit NEVER deletes: no rm, no unlink, anywhere. Runs never reuse a
// directory (roots are timestamped per invocation, run dirs unique within),
// so there is never a stale artifact to clear, and old runs simply accumulate
// for the user to prune.
export function ensureDir(dir: string) {
  mkdirSync(dir, { recursive: true });
}

// --- disk headroom watchdog ----------------------------------------------
// The wide pass writes ~1GB/min of live traces + per-run temp; a full disk
// killed both engines AND wedged sshd (session spawn fails at 0 bytes
// free), so no amount of headroom is a fix - only refusing to launch
// below a floor is. Every launch path awaits this: below MIN_FREE_GB it
// blocks, logs once, and re-checks until space returns (the engines'
// own pruning between targets frees it), instead of writing the box to
// death.
const MIN_FREE_GB = +(process.env.WSF_MIN_FREE_GB ?? "20");
export function freeGB(dir: string): number {
  try {
    // statfs on the drive holding the work dir
    const st = statfsSync(dir);
    return (st.bavail * st.bsize) / 2 ** 30;
  } catch {
    return Infinity; // cannot measure: never block
  }
}
let headroomWarned = false;
export async function awaitHeadroom(workDir: string): Promise<void> {
  for (;;) {
    const free = freeGB(workDir);
    if (free >= MIN_FREE_GB) {
      if (headroomWarned) {
        console.log(`  [headroom] ${free.toFixed(1)}GB free - resuming launches`);
        headroomWarned = false;
      }
      return;
    }
    if (!headroomWarned) {
      console.log(`  [headroom] ${free.toFixed(1)}GB free < ${MIN_FREE_GB}GB floor - pausing new launches until space returns`);
      headroomWarned = true;
    }
    await Bun.sleep(30_000);
  }
}

// Per-invocation timestamp used to build never-reused output roots.
export const stamp = new Date().toISOString().replace(/[:.]/g, "-");

// A run's traces: the parent bun's log PLUS one per injected bun child
// (recursive injection). Merge them - a fault that fires in a child, or a
// syscall a child makes, belongs to the run. Records keep their own pid via
// a note; seq numbers are per-process and not comparable across logs.
export async function readTraceDir(dir: string, opts: { faultsOnly?: boolean } = {}): Promise<Trace | null> {
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter(f => f.startsWith("wsf-") && f.endsWith(".log"));
  if (!files.length) return null;
  const merged: Trace = { notes: [], recs: [], recCount: 0, bunBase: "0", cleanEnd: true, attached: 0, modules: [], termStacks: [], leaks: [], leaksByProc: [] };
  for (const f of files) {
    let t: Trace;
    try {
      t = parseTrace(await Bun.file(join(dir, f)).text(), opts.faultsOnly);
    } catch (err) {
      // A single unreadable/oversized log degrades to a note, never an
      // exception - one bad trace must not take a whole sweep down.
      merged.notes.push(`# read-error ${f}: ${String(err).slice(0, 120)}`);
      merged.cleanEnd = false;
      continue;
    }
    merged.notes.push(`# --- ${f} ---`);
    for (const n of t.notes) merged.notes.push(n); // no spread: 100k+ args overflow the stack
    for (const r of t.recs) merged.recs.push(r);
    merged.recCount += t.recCount;
    for (const m of t.modules) merged.modules.push(m);
    for (const ts of t.termStacks) merged.termStacks.push(ts);
    for (const l of t.leaks) merged.leaks.push(l);
    // Leaks are a per-PROCESS property: a test that spawns N children has
    // N sets of standing handles - keep each process's set separate so the
    // oracle judges every process on its own, never a merged multiset.
    merged.leaksByProc.push(t.leaks);
    if (merged.bunBase === "0") merged.bunBase = t.bunBase;
    merged.cleanEnd = merged.cleanEnd && t.cleanEnd;
    merged.attached = Math.max(merged.attached, t.attached);
  }
  return merged;
}

// The trace log a run just wrote: newest wsf-*.log by mtime. Directories
// are unique per run so there is normally exactly one; newest-by-mtime is
// the guarantee even if a caller ever reuses one.
export function newestLog(dir: string): string | null {
  if (!existsSync(dir)) return null;
  const logs = readdirSync(dir)
    .filter(f => f.startsWith("wsf-") && f.endsWith(".log"))
    .map(f => ({ f, t: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  return logs.length ? join(dir, logs[0].f) : null;
}

// --- debugger-backed capture (Debugging Tools for Windows) --------------------

// Locate cdb.exe (Debugging Tools for Windows): WSF_CDB override, the usual
// SDK install dirs, then PATH. null => hang/crash CAPTURE is unavailable;
// tracing, sweeping and classification all still work — findings simply
// carry no stacks until setup.ps1 -InstallDebuggers is run.
function findCdb(): string | null {
  const candidates = [
    process.env.WSF_CDB,
    join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Windows Kits\\10\\Debuggers\\x64\\cdb.exe"),
    join(process.env.ProgramFiles ?? "C:\\Program Files", "Windows Kits\\10\\Debuggers\\x64\\cdb.exe"),
  ];
  for (const c of candidates) if (c && existsSync(c)) return c;
  const w = Bun.spawnSync(["where", "cdb"]).stdout.toString().split(/\r?\n/)[0]?.trim();
  return w && existsSync(w) ? w : null;
}
export const cdb: string | null = findCdb();
export const symbolServer = "srv*C:\\symbols*https://msdl.microsoft.com/download/symbols";

// --- panic backtrace symbolization -------------------------------------
// A rust panic prints its own backtrace as raw "0x7ff7... in ??? (???)"
// frames (bun.exe addresses). wsfsym cannot resolve RVAs this deep into the
// ~1 GB debug image, so resolve them with cdb -z against the exe: convert
// each address to an exe-relative offset via the traced module base and
// "ln bun_debug+0x<off>" it. Returns the resolved symbols, panic-site first.
export async function symbolizePanicBacktrace(image: string, stderr: string, bunBaseHex: string): Promise<string[]> {
  if (!cdb || !bunBaseHex) return [];
  const base = BigInt("0x" + bunBaseHex);
  const addrs = [...stderr.matchAll(/0x(7[fF][fF]7[0-9a-fA-F]{8,})/g)]
    .map(m => BigInt("0x" + m[1]))
    .filter(a => a >= base)
    .slice(0, 28);
  if (!addrs.length) return [];
  const cmds = addrs.map(a => `ln bun_debug+0x${(a - base).toString(16)}`).join(";");
  const proc = Bun.spawn([cdb, "-z", image, "-c", `${cmds};q`], { stdout: "pipe", stderr: "ignore" });
  const timer = setTimeout(() => proc.kill(), 90_000);
  const text = await new Response(proc.stdout).text();
  clearTimeout(timer);
  await proc.exited;
  // "ln" prints "(addr)   bun_debug!<symbol>+0x..   |  (addr) next-symbol";
  // keep the first (containing) symbol of each match line, in frame order.
  const syms: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*\([0-9a-f`]+\)\s+bun_debug!(\S+)/i.exec(line);
    if (m) syms.push(m[1].replace(/\+0x[0-9a-f]+$/i, ""));
  }
  return syms;
}


// PID of a running process by image name (first match), or null.
export function pidOf(image: string): number | null {
  const r = Bun.spawnSync(["powershell", "-NoProfile", "-Command",
    `(Get-Process -Name '${image.replace(/\.exe$/i, "")}' -ErrorAction SilentlyContinue | Select-Object -First 1).Id`]);
  const s = r.stdout.toString().trim();
  return s ? +s : null;
}

// Attach to a hung process and dump every thread's stack. Non-invasive
// (-pv) so it works even if the process is deadlocked in the loader.
export async function captureHangStacks(pid: number, outFile: string): Promise<string> {
  if (!cdb) return "(cdb.exe not installed: no thread stacks captured — run setup.ps1 -InstallDebuggers)";
  const cmdFile = outFile + ".cmd.txt";
  await Bun.write(cmdFile, ".lines -e\n~*kv 16\nq\n");
  const r = Bun.spawnSync([cdb, "-pv", "-p", String(pid), "-cf", cmdFile], {
    env: { ...(process.env as Record<string, string>), _NT_SYMBOL_PATH: symbolServer },
  });
  const text = r.stdout.toString();
  await Bun.write(outFile, text);
  return text;
}

// One replay of a scheduled fault, with hang/crash evidence captured.
// Used by both the triage tool and the sweeper's auto-verify phase, so a
// finding is judged by identical logic everywhere.
// Runs that finish but take this long are "slow": a symptom in itself, and
// the source of HANG-vs-not verdict flapping right under the watchdog.
export const SLOW_MS = 8000;

export interface ReplayResult {
  outcome: "clean" | "no-fire" | "error-exit" | "slow" | "CRASH" | "HANG";
  exitCode: number | null;
  ms: number;
  fired: number;
  faultRec: Rec | null;
  hangStacks: string | null;
  crashDump: string | null;
  crashSig: CrashSig | null; // crash by output signature
  stdout: string;
  stderr: string;
  dir: string;
}
export async function replayCoordinate(opts: {
  bun: string;
  args: string[];
  schedule: string; // schedule line
  dir: string;
  timeoutMs: number;
  capture?: boolean; // capture hang stacks / crash dump (default true)
}): Promise<ReplayResult> {
  const capture = opts.capture !== false;
  ensureDir(opts.dir);
  const sched = join(opts.dir, "schedule.txt");
  await Bun.write(sched, opts.schedule + "\n");
  // Private TEMP inside the run dir: test files create temp dirs and a
  // killed/crashed run never cleans up - under the run dir that litter is
  // reaped by the run's own retention instead of accumulating in %TEMP%.
  await awaitHeadroom(opts.dir);
  const runTmp = join(opts.dir, "tmp");
  ensureDir(runTmp);
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    WSF_LOG_DIR: opts.dir,
    WSF_MODE: "inject",
    WSF_SCHEDULE: sched,
    TEMP: runTmp,
    TMP: runTmp,
    BUN_DEBUG_QUIET_LOGS: "1",
  };
  const bunImage = basename(opts.bun);
  const outFile = join(opts.dir, "stdout.txt");
  const errFile = join(opts.dir, "stderr.txt");
  const t0 = performance.now();
  const proc = Bun.spawn([wsfrun, "--", opts.bun, ...opts.args], {
    cwd: opts.dir,
    env,
    stdin: "ignore",
    stdout: Bun.file(outFile),
    stderr: Bun.file(errFile),
  });
  let timedOut = false;
  let hangStacks: string | null = null;
  const timer = setTimeout(async () => {
    timedOut = true;
    if (capture) {
      const pid = pidOf(bunImage);
      if (pid) {
        try {
          hangStacks = await captureHangStacks(pid, join(opts.dir, "hang-stacks.txt"));
        } catch {}
      }
    }
    proc.kill(9);
    // Kill THIS run's tree by pid - never by image name: the driver itself
    // may be running as the same image (bun.exe driving a bun.exe target),
    // and a machine-wide /IM sweep took the drivers down with every
    // timed-out run of the release binary.
    if (proc.pid) Bun.spawnSync(["taskkill", "/F", "/PID", String(proc.pid), "/T"], { stdout: "ignore", stderr: "ignore" });
  }, opts.timeoutMs);
  await proc.exited;
  clearTimeout(timer);
  const ms = Math.round(performance.now() - t0);
  const exitCode = timedOut ? null : proc.exitCode;
  const stdout = await Bun.file(outFile).text().catch(() => "");
  const stderr = await Bun.file(errFile).text().catch(() => "");
  // Crash = an NTSTATUS-style exit OR a crash the output confesses to
  // (bun's handler / a spawned bun child mask the exit code otherwise).
  const crashSig = timedOut ? null : detectCrash(stdout, stderr);
  const crash = (exitCode !== null && (exitCode >= 0x80000000 || exitCode < 0)) || crashSig !== null;
  const trace = await readTraceDir(opts.dir, { faultsOnly: true });
  const fired = trace ? trace.recs.filter(r => r.fault) : [];
  let outcome: ReplayResult["outcome"] = "clean";
  if (timedOut) outcome = "HANG";
  else if (crash) outcome = "CRASH";
  else if (!fired.length) outcome = "no-fire";
  else if (ms >= SLOW_MS) outcome = "slow"; // finished, but the fault made it crawl
  else if (exitCode !== 0) outcome = "error-exit";
  let crashDump: string | null = null;
  if (crash && capture)
    crashDump = await captureCrash([wsfrun, "--", opts.bun, ...opts.args], env, join(opts.dir, "crash-stack.txt"));
  return {
    outcome,
    exitCode,
    ms,
    fired: fired.length,
    faultRec: fired[0] ?? null,
    hangStacks,
    crashDump,
    crashSig,
    stdout,
    stderr,
    dir: opts.dir,
  };
}

// Condense raw cdb '~*kv' output into a per-thread digest: symbol names only,
// top few frames per thread, so "main thread parked in uv__poll <- uv_run"
// is one line instead of a 12KB wade. Raw output stays available for depth.
export function digestStacks(text: string, framesPerThread = 6): string[] {
  const out: string[] = [];
  let cur: { id: string; frames: string[] } | null = null;
  const flush = () => {
    if (cur) out.push(`thread ${cur.id}: ${cur.frames.length ? cur.frames.join(" <- ") : "(no symbols)"}`);
  };
  for (const line of text.split(/\r?\n/)) {
    const th = /^\s*(?:\.\s*)?(\d+)\s+Id:\s+[0-9a-f]+\.([0-9a-f]+)/i.exec(line);
    if (th) {
      flush();
      cur = { id: `${th[1]} (tid ${th[2]})`, frames: [] };
      continue;
    }
    if (!cur || cur.frames.length >= framesPerThread) continue;
    const fr = /:\s+([A-Za-z0-9_]+)!([^\s\[+]+)/.exec(line);
    // Drop the interceptor's own frames (winsysfuzz!WsfExport sits between
    // every hooked syscall and its caller) so the chain reads naturally.
    if (fr && fr[1].toLowerCase() !== "winsysfuzz" && fr[2] !== "WsfExport") cur.frames.push(fr[2]);
  }
  flush();
  return out;
}

// Workloads print 'STAGE: <name>' before each step; the last one seen in a
// hung/slow run's stdout localizes the failure to a step for free.
export function lastStage(stdout: string): string | null {
  const stages = stdout.split("\n").filter(l => l.startsWith("STAGE: "));
  return stages.length ? stages[stages.length - 1].slice(7).trim() : null;
}

// Re-run a target under the debugger, break on access violation, dump state.
export async function captureCrash(cmdline: string[], env: Record<string, string>, outFile: string): Promise<string> {
  if (!cdb) return "(cdb.exe not installed: no crash stack captured — run setup.ps1 -InstallDebuggers)";
  const cmdFile = outFile + ".cmd.txt";
  await Bun.write(
    cmdFile,
    'sxe -c ".echo ===EXCEPTION===;.exr -1;.echo ===REGISTERS===;r;.echo ===STACK===;kv 30;.echo ===MODULES===;lm;q" av\n' +
      "sxd ibp\nsxd cpr\nsxd epr\ng\nq\n",
  );
  const r = Bun.spawnSync([cdb, "-o", "-cf", cmdFile, ...cmdline], {
    env: { ...env, _NT_SYMBOL_PATH: symbolServer },
  });
  const text = r.stdout.toString();
  await Bun.write(outFile, text);
  return text;
}

export async function runOnce(o: RunOpts): Promise<RunResult> {
  ensureDir(o.workDir);
  await awaitHeadroom(o.workDir);
  const runTmp = join(o.workDir, "tmp");
  ensureDir(runTmp);
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    WSF_LOG_DIR: o.workDir,
    WSF_MODE: o.schedule ? "inject" : "trace",
    TEMP: runTmp,
    TMP: runTmp,
    BUN_DEBUG_QUIET_LOGS: "1",
    ...(o.env ?? {}),
  };
  if (o.schedule) env.WSF_SCHEDULE = o.schedule;
  else delete env.WSF_SCHEDULE;

  // stdio to FILES, never pipes: the target's grandchildren (spawned cmd,
  // servers) can inherit a pipe's write end and hold it open past exit,
  // wedging a pipe read forever. Files can't do that, and the runner must
  // always return — it is the fuzzer's clock.
  const outFile = join(o.workDir, "stdout.txt");
  const errFile = join(o.workDir, "stderr.txt");
  const t0 = performance.now();
  const cwd = o.cwd ?? join(o.workDir, "cwd");
  ensureDir(cwd);
  const proc = Bun.spawn([wsfrun, "--", o.bun, ...o.args], {
    cwd,
    env,
    stdin: "ignore",
    stdout: Bun.file(outFile),
    stderr: Bun.file(errFile),
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill(9);
    // wsfrun's death does not take the target with it; kill this run's own
    // process tree by pid (never by image name - see runOnce).
    if (proc.pid) Bun.spawnSync(["taskkill", "/F", "/PID", String(proc.pid), "/T"], { stdout: "ignore", stderr: "ignore" });
  }, o.timeoutMs);
  await proc.exited;
  clearTimeout(timer);
  const ms = Math.round(performance.now() - t0);
  const stdout = await Bun.file(outFile).text().catch(() => "");
  const stderr = await Bun.file(errFile).text().catch(() => "");

  const logPath = newestLog(o.workDir);
  const code = timedOut ? null : proc.exitCode;
  // Two crash oracles: an NTSTATUS-style exit code (>=0x80000000 unsigned
  // or negative signed, depending on plumbing), OR a crash confessed in the
  // output - bun's own handler and crashing spawned bun children hide from
  // exit codes but not from what they print.
  const crashSig = timedOut ? null : detectCrash(stdout, stderr);
  return {
    outcome: timedOut ? "hang" : "exit",
    exitCode: code,
    ms,
    stdout,
    stderr,
    logPath,
    dir: o.workDir,
    crash: (code !== null && (code >= 0x80000000 || code < 0)) || crashSig !== null,
    crashSig,
  };
}

function basename(p: string) {
  return p.replace(/^.*[\\/]/, "");
}

export async function readTrace(logPath: string | null): Promise<Trace | null> {
  if (!logPath || !existsSync(logPath)) return null;
  return parseTrace(await Bun.file(logPath).text());
}
