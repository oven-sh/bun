import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const usage = `bun test/aot/sanitizers/thread-sanitizer.ts <command>

The ahead-of-time compiler under ThreadSanitizer, on Linux x64: the front end (source to IR) and the engine's
compile step (IR to image). No compiled program is run.

  build-engine [--ninja <file>] [--jobs <n>] [option of scripts/build.ts ..]   the jsc shell, in build/thread-sanitizer
  build-front-end [--control]      bun-sema, in build/thread-sanitizer-front-end; --codegen <dir>: the codegen folder of
                                   a build of Bun of the same sources, with zstd's objects in ../obj/vendor/zstd
                                   --control: every task of the checker adds to one plain word: a data race that must be reported
  compile [--largest <n>] [file..] each program through both; the default: the 100 largest of test/aot/programs
                                   --jobs <n> at a time, --threads <n> for the engine's compiler, --only front-end | engine
  read [--front-end] [--binary <file>] <log>..   sorts logs that were written elsewhere

A run prints how many reports there are, which are passed over and why, and those that are ours, by kind.
The engine's control is always there: two counters of LinkBuffer that every compiler thread adds to are reported in
every run; a run in which they are missing has not looked. Exit code 1: reports of ours, or a missing control.`;

const root = resolve(import.meta.dir, "..", "..", "..");
const engineFolder = join(root, "build", "thread-sanitizer");
const frontEndFolder = join(root, "build", "thread-sanitizer-front-end");
const shell = join(engineFolder, "jsc");
const frontEnd = join(frontEndFolder, "x86_64-unknown-linux-gnu", "release", "bun-sema");
const work = join(engineFolder, "runs");
const args = process.argv.slice(2);
const command = args.shift();

function option(name: string): string | undefined {
  const at = args.indexOf(name);
  return at < 0 ? undefined : args.splice(at, 2)[1];
}
function flag(name: string): boolean {
  const at = args.indexOf(name);
  if (at >= 0) args.splice(at, 1);
  return at >= 0;
}
function must(cmd: string[], env: Record<string, string> = {}) {
  const done = spawnSync(cmd[0], cmd.slice(1), { cwd: root, stdio: "inherit", env: { ...process.env, ...env } });
  if (done.status !== 0) process.exit(done.status ?? 1);
}

const upstream: [string, string][] = [
  ["WTF::ParallelHelperClient::", "m_numActive is asserted ahead of the lock"],
  ["WTF::ParallelHelperPool::", "m_numActive is asserted ahead of the lock"],
  ["WTF::Thread::destructTLS", "a thread that ends"],
  ["WTF::ThreadGroup", "a thread that ends"],
  ["JSC::LinkBuffer::", "two counters of LinkBuffer"],
  ["JSC::SlotVisitor", "the collector"],
  ["JSC::Heap::", "the collector"],
  ["JSC::MarkedBlock", "the collector"],
  ["JSC::MarkedSpace", "the collector"],
  ["JSC::BlockDirectory", "the collector"],
  ["JSC::Collector", "the collector"],
  ["JSC::CompiledLayoutVisitor", "the collector"],
  ["JSC::VMTraps", "traps"],
  ["JSC::JITWorklist", "the JIT of the shell itself"],
  ["JSC::DFG::", "the JIT of the shell itself"],
  ["JSC::FTL::", "the JIT of the shell itself"],
];
const kinds = {
  engine: {
    ours: /JSC::AOT|JavaScriptCore\/aot\/|JSC::B3|JSC::BytecodeLinkEncoder|JSC::buildAOTFile/,
    plumbing: /^((void|bool|auto|unsigned int) )?(WTF::|std::|bmalloc|pas_|__tsan|__interceptor|mem(cpy|set|move|cmp)|operator (new|delete)|malloc|free|realloc|calloc|posix_memalign|decltype)/,
  },
  frontEnd: {
    ours: /bun_|sema/,
    plumbing: /^(<?(core|std|alloc|hashbrown|smallvec)::|<&|<\[|__tsan|__interceptor|__rust|mem(cpy|set|move|cmp)|bcmp|malloc|free|realloc|calloc|posix_memalign)/,
  },
};

function tidy(frame: string): string {
  frame = frame.replace(/ <null>.*$/, "").replace(/ \S*\/((?:Source|src)\/\S+).*$/, " $1");
  let depth = 0, text = "";
  for (const c of frame) {
    if (c === "<" || c === "(") depth++;
    else if (c === ">" || c === ")") depth--;
    else if (!depth) text += c;
  }
  return text.replace(/\s+/g, " ").trim();
}

function named(text: string, binary: string): string {
  const wanted = [...new Set([...text.matchAll(/^ +#\d+ <null> <null> \(\S+?\+(0x[0-9a-f]+)\)/gm)].map(match => match[1]))];
  if (!wanted.length) return text;
  const said = spawnSync("llvm-symbolizer", ["--obj=" + binary, "--no-inlines", "--output-style=LLVM"], { input: wanted.join("\n") + "\n", encoding: "utf8", maxBuffer: 1 << 30 }).stdout.split("\n\n");
  const names = new Map(wanted.map((address, i) => [address, (said[i] ?? "").trim().split("\n").slice(0, 2).join(" ")]));
  return text.replace(/^( +#\d+ )<null> <null> (\(\S+?\+(0x[0-9a-f]+)\))/gm, (_, head, place, address) => head + (names.get(address) || "<null> <null>") + " " + place);
}

function sort(logs: { of: string; text: string }[], which: keyof typeof kinds) {
  const { ours, plumbing } = kinds[which];
  const passedOver = new Map<string, number>(), found = new Map<string, { count: number; of: Set<string>; whole: string }>();
  let all = 0;
  for (const { of, text } of logs) {
    for (const report of text.split(/(?=^WARNING: ThreadSanitizer: )/m)) {
      if (!report.startsWith("WARNING")) continue;
      all++;
      const key: string[] = [];
      let isOurs = false, excuse: string | undefined;
      for (const [, head, body] of [...report.matchAll(/^  ((?:Previous )?(?:[Aa]tomic )?(?:[Ww]rite|[Rr]ead) of size \d+)[^\n]*\n((?:    #\d+ [^\n]*\n)+)/gm)].slice(0, 2)) {
        const raw = [...body.matchAll(/^    #\d+ (.*)$/gm)].map(match => match[1]);
        const frames = raw.map(tidy);
        excuse ??= upstream.find(([name]) => frames[0]?.startsWith(name) || frames[0]?.includes(" " + name))?.[1];
        const first = frames.findIndex(frame => !plumbing.test(frame));
        if (first >= 0 && ours.test(raw[first])) isOurs = true;
        key.push(`${head.replace("Previous ", "").toLowerCase()}: ${frames[0]?.slice(0, 90)}${first > 0 ? " <- " + frames[first].slice(0, 120) : ""}`);
      }
      key.sort();
      if (key.length === 2 && key[0].startsWith("atomic write of size 4") && key[1].startsWith("read of size 4") && key.every(side => /findLongestRepeatCandidates|FastBitVector|compare_exchange/.test(side)))
        excuse = "FastBitVector::atomicSetAndCheck reads the word plainly ahead of its compare-and-swap";
      excuse ??= isOurs ? undefined : "no frame of ours is the first behind the plumbing";
      if (excuse) {
        passedOver.set(excuse, (passedOver.get(excuse) ?? 0) + 1);
        continue;
      }
      const name = report.slice("WARNING: ThreadSanitizer: ".length).split(" (pid")[0] + " | " + key.join(" || ");
      const entry = found.get(name) ?? { count: 0, of: new Set<string>(), whole: `=== ${of}\n${report}` };
      entry.count++;
      entry.of.add(of);
      found.set(name, entry);
    }
  }
  console.log(`${which === "engine" ? "the engine" : "the front end"}: ${all} reports; passed over: ${[...passedOver].map(([why, count]) => `${count} ${why}`).join(", ") || "none"}; ours: ${[...found.values()].reduce((sum, entry) => sum + entry.count, 0)} reports of ${found.size} kinds`);
  for (const [name, entry] of [...found].sort((a, b) => b[1].count - a[1].count)) console.log(`${String(entry.count).padStart(6)} in ${entry.of.size} programs  ${name}`);
  return { found, hasControl: which !== "engine" || passedOver.has("two counters of LinkBuffer") };
}

function largest(count: number): string[] {
  const programs = join(root, "test", "aot", "programs"), all: [number, string][] = [];
  for (const topic of readdirSync(programs)) {
    if (!statSync(join(programs, topic)).isDirectory()) continue;
    for (const entry of readdirSync(join(programs, topic))) {
      const path = join(programs, topic, entry);
      if (statSync(path).isDirectory()) {
        const main = ["program.ts", "program.tsx", "program.js", "main.ts", "main.tsx", "main.js"].map(name => join(path, name)).find(existsSync);
        if (main) all.push([readdirSync(path).reduce((sum, name) => sum + statSync(join(path, name)).size, 0), main]);
      } else if (/\.(ts|tsx|js)$/.test(entry) && !entry.endsWith(".d.ts")) all.push([statSync(path).size, path]);
    }
  }
  return all.sort((a, b) => b[0] - a[0]).slice(0, count).map(([, path]) => path);
}

const options = (log: string) => `halt_on_error=0:report_signal_unsafe=0:report_thread_leaks=0:history_size=4:exitcode=0:log_path=${log}`;
const logsOf = (prefix: string) => readdirSync(work).filter(name => name.startsWith(prefix)).map(name => readFileSync(join(work, name), "utf8")).join("");

if (command === "build-engine") {
  const ninja = option("--ninja") ?? "ninja", jobs = option("--jobs");
  must(["bun", "scripts/build.ts", "--profile=release-local", "--asan=true", "--assertions=false", "--build-dir=" + engineFolder, "--configure-only", "--target=jsc", ...args]);
  writeFileSync(join(engineFolder, "thread-sanitizer.ninja"), readFileSync(join(engineFolder, "build.ninja"), "utf8").replaceAll("-fsanitize=address", "-fsanitize=thread").replaceAll("-fsanitize-address-use-after-return=never", ""));
  must([ninja, "-C", engineFolder, "-f", "thread-sanitizer.ninja", ...(jobs ? ["-j" + jobs] : []), "jsc"]);
} else if (command === "build-front-end") {
  const codegen = option("--codegen") ?? ["release", "release-local", "debug"].map(name => join(root, "build", name, "codegen")).find(existsSync);
  if (!codegen) throw new Error("--codegen <dir>: no build of Bun was found");
  const control = flag("--control") ? " --cfg=bun_data_race_for_testing" : "";
  must(["cargo", "build", "--release", "-p", "bun_sema_standalone", "--no-default-features", "-Zbuild-std", "--target", "x86_64-unknown-linux-gnu", "--target-dir", frontEndFolder], {
    BUN_CODEGEN_DIR: resolve(codegen),
    RUSTFLAGS: "-C link-arg=-fuse-ld=lld -C link-arg=-Qunused-arguments -A linker_messages -Zsanitizer=thread --check-cfg=cfg(bun_asan)" + control,
  });
} else if (command === "compile") {
  const jobs = Number(option("--jobs") ?? Math.max(1, availableParallelism() >> 3)), threads = option("--threads") ?? "8", only = option("--only");
  const count = option("--largest");
  const sources = args.length && !count ? args.map(path => resolve(path)) : largest(Number(count ?? 100));
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const typescript = dirname(Bun.resolveSync("typescript/lib/lib.d.ts", root));
  const failed: string[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: jobs }, async () => {
    while (next < sources.length) {
      const i = next++, source = sources[i], ir = join(work, i + ".ir");
      const front = Bun.spawn({
        cmd: [frontEnd, "cli", source, "--allowJs", "--resolveJsonModule", "--no-builtin-modules", "--aot", "--aot-out=" + ir],
        cwd: dirname(source), stdout: "ignore", stderr: "ignore",
        env: { ...process.env, BUN_SEMA_TS_LIB: typescript, TSAN_OPTIONS: options(join(work, i + ".front-end")) },
      });
      await front.exited;
      if (!existsSync(ir)) continue;
      if (only === "front-end") continue;
      const engine = Bun.spawn({
        cmd: [shell, "--useDollarVM=1", "--numberOfAOTCompilerThreads=" + threads, join(root, "test/aot/shell/image.js"), "--", ir, join(work, i + ".image"), join(root, "test/aot/shell/stub.js")],
        cwd: dirname(source), stdout: "ignore", stderr: "ignore",
        env: { ...process.env, TSAN_OPTIONS: options(join(work, i + ".engine")) },
      });
      if ((await engine.exited) !== 0 || !existsSync(join(work, i + ".image"))) failed.push(source);
      rmSync(join(work, i + ".image"), { force: true });
      rmSync(ir, { force: true });
    }
  }));
  const of = (kind: string) => sources.map((source, i) => ({ of: source.slice(root.length + 1), text: logsOf(`${i}.${kind}.`) }));
  const front = sort(of("front-end"), "frontEnd"), engine = only === "front-end" ? undefined : sort(of("engine"), "engine");
  writeFileSync(join(engineFolder, "reports.txt"), [...front.found.values(), ...(engine?.found.values() ?? [])].map(entry => entry.whole).join("\n\n"));
  for (const source of failed) console.log("no image: " + source);
  if (engine && !engine.hasControl) console.log("THE CONTROL IS MISSING: the two counters of LinkBuffer were not reported");
  console.log(`${sources.length} programs; the reports that are ours, whole: ${join(engineFolder, "reports.txt")}`);
  process.exit(front.found.size || engine?.found.size || failed.length || (engine && !engine.hasControl) ? 1 : 0);
} else if (command === "read") {
  const which = flag("--front-end") ? "frontEnd" : "engine", binary = option("--binary");
  const { found } = sort(args.map(path => ({ of: basename(path), text: binary ? named(readFileSync(path, "utf8"), binary) : readFileSync(path, "utf8") })), which);
  for (const entry of found.values()) console.log("\n" + entry.whole);
  process.exit(found.size ? 1 : 0);
} else {
  console.log(usage);
  process.exit(command ? 1 : 0);
}
