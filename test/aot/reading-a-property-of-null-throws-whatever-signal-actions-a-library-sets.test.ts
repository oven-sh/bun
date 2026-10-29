import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isLinux, isMusl, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { describe, test } from "./supported";

// Compiled code turns a fault at one of its own null checks into a TypeError, and one at the poll of a loop into a look at what
// the thread is asked to do. A library that the program loads may set an action for the same signals, or block them: it hears of
// everything but those, as it does without --aot.
const compiler = process.env.CC || Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");
// A sanitizer's run time defines sigaction() and signal() itself.
const skipped = isWindows || isASAN || !compiler;
if (!isWindows && !compiler)
  console.error("SKIPPED: " + import.meta.path + ": it needs a C compiler ($CC, cc, gcc or clang)");

const library = `#define _GNU_SOURCE
#include <dlfcn.h>
#include <pthread.h>
#include <signal.h>
#include <string.h>
#include <unistd.h>

typedef void (*handler_t)(int);
static struct sigaction before;
static volatile int calls;

static void end_process(int n) { static const char text[] = "the library's handler exits\\n"; write(1, text, sizeof text - 1); _exit(70); }
static void count(int n) { calls++; }
static void count_and_call_the_one_before(int n, siginfo_t* info, void* context)
{
    calls++;
    if (before.sa_flags & SA_SIGINFO) before.sa_sigaction(n, info, context);
    else if (before.sa_handler != SIG_DFL && before.sa_handler != SIG_IGN) before.sa_handler(n);
    else signal(n, SIG_DFL);
}
static void* set_default(void* n) { signal((int)(long)n, SIG_DFL); return 0; }

int handler_calls(void) { return calls; }
void signal_default(int n) { signal(n, SIG_DFL); }
void signal_ignore(int n) { signal(n, SIG_IGN); }
void signal_ends(int n) { signal(n, end_process); }
void signal_counts(int n) { signal(n, count); }
void sigaction_default(int n) { struct sigaction a; memset(&a, 0, sizeof a); a.sa_handler = SIG_DFL; sigaction(n, &a, 0); }
void sigaction_chains(int n) { struct sigaction a; memset(&a, 0, sizeof a); a.sa_sigaction = count_and_call_the_one_before; a.sa_flags = SA_SIGINFO | SA_ONSTACK | SA_NODEFER; sigaction(n, &a, &before); }
void sigaction_puts_back(int n) { sigaction(n, &before, 0); }
void sigset_default(int n) { sigset(n, SIG_DFL); }
void sigignore_it(int n) { sigignore(n); }
void found_by_name_default(int n) { handler_t (*set)(int, handler_t) = (handler_t (*)(int, handler_t))dlsym(RTLD_DEFAULT, "signal"); set(n, SIG_DFL); }
void another_thread_default(int n) { pthread_t thread; pthread_create(&thread, 0, set_default, (void*)(long)n); pthread_join(thread, 0); }
#ifdef __GLIBC__
void sysv_signal_default(int n) { sysv_signal(n, SIG_DFL); }
#else
void sysv_signal_default(int n) { signal(n, SIG_DFL); }
#endif
// 0: the default action, 1: ignored, 2: a handler of the library's, 3: another handler
int action_in_place(int n)
{
    struct sigaction a;
    sigaction(n, 0, &a);
    if (a.sa_handler == SIG_DFL) return 0;
    if (a.sa_handler == SIG_IGN) return 1;
    return a.sa_handler == end_process || a.sa_handler == count || a.sa_sigaction == count_and_call_the_one_before ? 2 : 3;
}
void pthread_sigmask_blocks(int n) { sigset_t set; sigemptyset(&set); sigaddset(&set, n); pthread_sigmask(SIG_BLOCK, &set, 0); }
void sigprocmask_blocks_all(int n) { sigset_t set; sigfillset(&set); sigprocmask(SIG_SETMASK, &set, 0); }
void raise_it(int n) { raise(n); }
void read_address_8(int n) { *(volatile int*)8; }
`;

const readers = `function readX(point: { x: number } | null): number { return point!.x; }
function readXPlusOne(point: { x: number } | null): number { return point!.x + 1; }
const readers = [readX, readXPlusOne];
const none: { x: number } | null = JSON.parse("null");
`;

const names = [
  "signal_default",
  "signal_ignore",
  "signal_ends",
  "signal_counts",
  "sigaction_default",
  "sigaction_chains",
  "sigaction_puts_back",
  "sigset_default",
  "sigignore_it",
  "found_by_name_default",
  "another_thread_default",
  "sysv_signal_default",
  "pthread_sigmask_blocks",
  "sigprocmask_blocks_all",
  "raise_it",
  "read_address_8",
];

const open = `import { dlopen, FFIType } from "bun:ffi";
const library = dlopen(process.argv[2], {
  handler_calls: { args: [], returns: FFIType.i32 },
  action_in_place: { args: [FFIType.i32], returns: FFIType.i32 },
${names.map(name => `  ${name}: { args: [FFIType.i32], returns: FFIType.void },\n`).join("")}}).symbols as unknown as Record<string, (signal?: number) => number>;
`;

// Every loop stands at the top level of the module.
const program = `${open}${readers}const name = process.argv[3] as NodeJS.Signals;
const signal = name === "SIGBUS" ? ${process.platform === "darwin" ? 10 : 7} : 11;
const listener = () => console.log("the listener hears", name);
let caught = 0;
for (let i = 0; i < 10; i++) try { readers[i & 1](none); } catch (error) { if (error instanceof TypeError) caught++; }
console.log("at first", caught);
for (const step of process.argv[4].split(",")) {
  if (step === "on") process.on(name, listener);
  else if (step === "off") process.off(name, listener);
  else if (step === "turn") await Bun.sleep(20);
  else library[step](signal);
  console.log(step, "leaves", library.action_in_place(signal));
}
caught = 0;
for (let i = 0; i < 10; i++) try { readers[i & 1](none); } catch (error) { if (error instanceof TypeError) caught++; }
console.log("in the end", caught, "the library's handler ran", library.handler_calls(), "times");
`;

const libcByName = `import { dlopen, FFIType } from "bun:ffi";
${readers}const libc = dlopen(process.argv[2], { signal: { args: [FFIType.i32, FFIType.ptr], returns: FFIType.ptr } });
let caught = 0;
for (let i = 0; i < 10; i++) try { readers[i & 1](none); } catch (error) { if (error instanceof TypeError) caught++; }
console.log("at first", caught);
libc.symbols.signal(11, null);
caught = 0;
for (let i = 0; i < 10; i++) try { readers[i & 1](none); } catch (error) { if (error instanceof TypeError) caught++; }
console.log("in the end", caught);
`;

const aWorkerReadsAllTheWhile = `import { dlopen, FFIType } from "bun:ffi";
const one = { args: [FFIType.i32], returns: FFIType.void } as const;
const library = dlopen(process.argv[2], {
  handler_calls: { args: [], returns: FFIType.i32 },
  sigaction_chains: one,
  sigaction_puts_back: one,
  signal_default: one,
  signal_counts: one,
}).symbols as unknown as Record<string, (signal?: number) => number>;
${readers}if (Bun.isMainThread) {
  const worker = new Worker(new URL(import.meta.url), { argv: process.argv.slice(2) });
  await new Promise(resolve => worker.addEventListener("message", resolve, { once: true }));
  const end = performance.now() + 1000;
  while (performance.now() < end) {
    for (let i = 0; i < 1000; i++) {
      library.sigaction_chains(11);
      library.sigaction_puts_back(11);
      library.signal_default(11);
      library.signal_counts(11);
    }
  }
  console.log("done, the library's handler ran", library.handler_calls(), "times");
  process.exit(0);
} else {
  postMessage("started");
  for (let i = 0; ; i++) try { readers[i & 1](none); } catch {}
}
`;

const aWorkerStandsInALoop = `${open}const worker = new Worker("./worker.ts");
await new Promise<void>(resolve => (worker.onmessage = () => resolve()));
library[process.argv[3]](11);
await worker.terminate();
console.log("terminated, the library's handler ran", library.handler_calls(), "times");
`;
const loopThatCallsNothing = `postMessage("started");
let turns = 0;
for (;;) turns = (turns + 1) | 0;
`;

// The loop has no handler around it and calls nothing of the program.
const theHeapFillsThreeTimes = `${open}type Link = { id: number; name: string; next: Link | null };
function fill(keep: Link[]): number {
  for (;;) keep.push({ id: keep.length, name: "n" + keep.length, next: keep.length ? keep[keep.length - 1] : null });
}
library[process.argv[3]](11);
let keep: Link[] = [];
for (let attempt = 0; attempt < 3; attempt++) {
  try {
    fill(keep);
  } catch (error) {
    console.log(attempt, error instanceof RangeError, keep.length > 1000);
    keep = [];
  }
}
console.log("afterward, the library's handler ran", library.handler_calls(), "times");
`;

const readsNullThenAnObject = `${readers}let value: { x: number } | null = JSON.parse(process.argv[2] ?? "null");
let caught = 0;
for (let i = 0; i < 10; i++) try { readers[i & 1](value); } catch { caught++; }
console.log("reads of null:", caught, "TypeErrors");
value = JSON.parse(process.argv[3] ?? '{"x":1}');
caught = 0;
for (let i = 0; i < 10; i++) try { readers[i & 1](value); } catch { caught++; }
console.log("reads of an object:", caught, "TypeErrors");
`;

// Runs a program until it stands at the instruction of its first null check again, after all of them, and sends it SIGSEGV there
// as another process would, with sigqueue(). How many of its reads of null a program finds by such an instruction is the compiler's choice:
// without $CHECKS it runs the program to its end and prints their number.
const sender = `#define _GNU_SOURCE
#include <elf.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ptrace.h>
#include <sys/uio.h>
#include <sys/user.h>
#include <sys/wait.h>
#include <unistd.h>

#if defined(__x86_64__)
#define PC(registers) (registers).rip
static const unsigned long trap = 0xcc, trap_mask = 0xff, trap_length = 1;
#else
#define PC(registers) (registers).pc
static const unsigned long trap = 0xd4200000, trap_mask = 0xffffffff, trap_length = 0;
#endif

int main(int argc, char** argv)
{
    pid_t child = fork();
    if (!child) {
        if (ptrace(PTRACE_TRACEME, 0, 0, 0)) _exit(126);
        execv(argv[1], argv + 1);
        _exit(127);
    }
    unsigned long site = 0, word = 0;
    int checks = 0, status, all = getenv("CHECKS") ? atoi(getenv("CHECKS")) : -1;
    struct user_regs_struct registers;
    struct iovec io = { &registers, sizeof registers };
    for (;;) {
        if (waitpid(child, &status, 0) < 0) return 125;
        if (WIFEXITED(status)) { if (all < 0) printf("%d\\n", checks); return WEXITSTATUS(status); }
        if (WIFSIGNALED(status)) { printf("ended by signal %d\\n", WTERMSIG(status)); return 0; }
        int signal_number = WSTOPSIG(status);
        if (signal_number == SIGSEGV && (all < 0 || checks < all)) {
            if (!checks++) { ptrace(PTRACE_GETREGSET, child, NT_PRSTATUS, &io); site = PC(registers); }
            if (checks == all) { word = ptrace(PTRACE_PEEKTEXT, child, site, 0); ptrace(PTRACE_POKETEXT, child, site, (word & ~trap_mask) | trap); }
        } else if (signal_number == SIGTRAP) {
            signal_number = 0;
            ptrace(PTRACE_GETREGSET, child, NT_PRSTATUS, &io);
            if (checks == all && PC(registers) - trap_length == site) {
                ptrace(PTRACE_POKETEXT, child, site, word);
                PC(registers) = site;
                ptrace(PTRACE_SETREGSET, child, NT_PRSTATUS, &io);
                siginfo_t info;
                memset(&info, 0, sizeof info);
                info.si_signo = signal_number = SIGSEGV;
                info.si_code = SI_QUEUE;
                info.si_pid = 5;
                ptrace(PTRACE_SETSIGINFO, child, 0, &info);
                checks++;
            }
        }
        ptrace(PTRACE_CONT, child, 0, signal_number);
    }
}
`;

// The kernel drops a signal whose action is the default one when it is sent to the first process of a PID namespace.
const noListenerIsLeft = `const listener = () => {};
process.on("SIGSEGV", listener);
process.off("SIGSEGV", listener);
Bun.spawnSync(["kill", "-SEGV", String(process.pid)]);
await Bun.sleep(50);
console.log("process", process.pid, "goes on");
`;
const asFirstProcess = ["unshare", "--user", "--map-root-user", "--pid", "--fork", "--mount-proc"];
const canBeFirstProcess =
  isLinux && !!Bun.which("unshare") && Bun.spawnSync([...asFirstProcess, "true"]).exitCode === 0;

const withoutCoreDump = ["sh", "-c", 'ulimit -c 0; exec "$0" "$@"'];

async function run(cmd: string[], cwd: string, env: Record<string, string> = {}) {
  await using proc = Bun.spawn({
    cmd: [...withoutCoreDump, ...cmd],
    cwd,
    env: { ...bunEnv, BUN_CRASH_REPORT_URL: "", BUN_ENABLE_CRASH_REPORTING: "0", ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode, signalCode: proc.signalCode };
}

// A reader stays a function of its own: copied into the `try` of its caller it would find null by a comparison.
async function build(directory: string, file: string, ...furtherEntryPoints: string[]) {
  const executable = join(directory, file.replace(/\.ts$/, ""));
  const built = await run(
    [
      bunExe(),
      "build",
      "--compile",
      "--aot",
      "--aot-disable=InlineCalls",
      file,
      ...furtherEntryPoints,
      "--outfile",
      executable,
    ],
    directory,
  );
  expect({ stderr: built.stderr, exitCode: built.exitCode }).toMatchObject({ exitCode: 0 });
  return executable;
}

async function buildLibrary(directory: string) {
  const path = join(directory, "libtakes.so");
  const built = await run(
    [compiler!, "-shared", "-fPIC", "-w", "-o", path, "library.c", "-lpthread", "-ldl"],
    directory,
  );
  expect(built).toMatchObject({ exitCode: 0 });
  return path;
}

// What the library does, and how the program ends: as it does without --aot, which each row is also compared with.
type Row = [steps: string, end: string | { exitCode?: number; signalCode?: string }];
const rows: Row[] = [
  ["signal_default", "in the end 10 the library's handler ran 0 times"],
  ["signal_ignore", "in the end 10 the library's handler ran 0 times"],
  ["signal_ends", "in the end 10 the library's handler ran 0 times"],
  ["signal_counts", "in the end 10 the library's handler ran 0 times"],
  ["sigaction_default", "in the end 10 the library's handler ran 0 times"],
  ["sigaction_chains", "in the end 10 the library's handler ran 0 times"],
  ["sigaction_chains,sigaction_puts_back", "in the end 10 the library's handler ran 0 times"],
  ["sigset_default", "in the end 10 the library's handler ran 0 times"],
  ["sigignore_it", "in the end 10 the library's handler ran 0 times"],
  ["sysv_signal_default", "in the end 10 the library's handler ran 0 times"],
  ["found_by_name_default", "in the end 10 the library's handler ran 0 times"],
  ["another_thread_default", "in the end 10 the library's handler ran 0 times"],
  ["pthread_sigmask_blocks", "in the end 10 the library's handler ran 0 times"],
  ["sigprocmask_blocks_all", "in the end 10 the library's handler ran 0 times"],
  // The library's action is in force for all that is not a null check of compiled code.
  ["signal_counts,raise_it", "in the end 10 the library's handler ran 1 times"],
  ["signal_ignore,raise_it", "in the end 10 the library's handler ran 0 times"],
  ["signal_ends,raise_it", { exitCode: 70 }],
  ["signal_ends,read_address_8", { exitCode: 70 }],
  ["signal_default,raise_it", { signalCode: "SIGSEGV" }],
  ["signal_default,read_address_8", { signalCode: "SIGSEGV" }],
  // POSIX leaves open what follows where the signal of a fault is ignored.
  ...(isLinux ? [["signal_ignore,read_address_8", { signalCode: "SIGSEGV" }] satisfies Row] : []),
  // Whoever sets the action last has it, the program's listeners among them.
  ["on,signal_counts,raise_it,turn", "in the end 10 the library's handler ran 1 times"],
  ["signal_counts,on,raise_it,turn", "in the end 10 the library's handler ran 0 times"],
  ["on,off,signal_counts,raise_it", "in the end 10 the library's handler ran 1 times"],
  ["signal_counts,on,off,raise_it", { signalCode: "SIGSEGV" }],
];

describe.skipIf(skipped).concurrent("reading a property of null throws a TypeError", () => {
  test("whatever action a library sets for the signal", async () => {
    using directory = tempDir("aot-a-library-sets-actions", { "main.ts": program, "library.c": library });
    const [executable, path] = await Promise.all([
      build(String(directory), "main.ts"),
      buildLibrary(String(directory)),
    ]);
    for (const [steps, end] of rows) {
      const compiled = await run([executable, path, "SIGSEGV", steps], String(directory));
      expect({ steps, ...compiled }).toEqual({
        steps,
        ...(await run([bunExe(), "main.ts", path, "SIGSEGV", steps], String(directory))),
      });
      if (typeof end === "string")
        expect({ steps, end: compiled.stdout.trimEnd().split("\n").at(-1), exitCode: compiled.exitCode }).toEqual({
          steps,
          end,
          exitCode: 0,
        });
      else expect({ steps, ...compiled }).toMatchObject(end);
    }
  }, 240_000);

  test.skipIf(!isLinux)(
    "when the program calls signal() of the C library by its name",
    async () => {
      using directory = tempDir("aot-libc-by-name", { "main.ts": libcByName });
      const executable = await build(String(directory), "main.ts");
      const libc = isMusl ? `libc.musl-${process.arch === "arm64" ? "aarch64" : "x86_64"}.so.1` : "libc.so.6";
      expect(await run([executable, libc], String(directory))).toEqual({
        stdout: "at first 10\nin the end 10\n",
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
    },
    120_000,
  );

  test.skipIf(!isLinux)(
    "and only then: a signal that a process sends while the program reads a property of an object is no TypeError",
    async () => {
      using directory = tempDir("aot-sent-at-a-read", { "main.ts": readsNullThenAnObject, "sender.c": sender });
      const [executable, built] = await Promise.all([
        build(String(directory), "main.ts"),
        run([compiler!, "-w", "-o", "sender", "sender.c"], String(directory)),
      ]);
      expect(built).toMatchObject({ exitCode: 0 });
      const counted = await run([join(String(directory), "sender"), executable], String(directory));
      if (counted.exitCode === 126) return console.error("SKIPPED: a process may not be traced here");
      const checks = counted.stdout.trimEnd().split("\n").at(-1)!;
      expect(Number(checks)).toBeWithin(1, 11);
      const { stdout, exitCode } = await run([join(String(directory), "sender"), executable], String(directory), {
        CHECKS: checks,
      });
      expect({ stdout, exitCode }).toEqual({
        stdout: "reads of null: 10 TypeErrors\nended by signal 11\n",
        exitCode: 0,
      });
    },
    120_000,
  );

  test.skipIf(!canBeFirstProcess)(
    "and a signal sent to the first process of a PID namespace does what it does without --aot",
    async () => {
      using directory = tempDir("aot-first-process", { "main.ts": noListenerIsLeft });
      const executable = await build(String(directory), "main.ts");
      const compiled = await run([...asFirstProcess, executable], String(directory));
      expect(compiled).toEqual(await run([...asFirstProcess, bunExe(), "main.ts"], String(directory)));
      expect(compiled).toEqual({ stdout: "process 1 goes on\n", stderr: "", exitCode: 0, signalCode: null });
    },
    120_000,
  );

  test("and a worker in a loop is terminated, whatever action a library has set", async () => {
    using directory = tempDir("aot-a-loop-behind-a-library-s-action", {
      "main.ts": aWorkerStandsInALoop,
      "worker.ts": loopThatCallsNothing,
      "library.c": library,
    });
    const [executable, path] = await Promise.all([
      build(String(directory), "main.ts", "worker.ts"),
      buildLibrary(String(directory)),
    ]);
    for (const step of ["signal_default", "signal_ignore", "signal_ends", "signal_counts", "sigaction_chains"])
      expect({ step, ...(await run([executable, path, step], String(directory))) }).toEqual({
        step,
        stdout: "terminated, the library's handler ran 0 times\n",
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
  }, 120_000);

  test("and a full heap ends in a RangeError, whatever action a library has set", async () => {
    using directory = tempDir("aot-a-full-heap-behind-a-library-s-action", {
      "main.ts": theHeapFillsThreeTimes,
      "library.c": library,
    });
    const [executable, path] = await Promise.all([
      build(String(directory), "main.ts"),
      buildLibrary(String(directory)),
    ]);
    for (const step of ["signal_default", "signal_ends", "sigaction_chains"])
      expect({
        step,
        ...(await run([executable, path, step], String(directory), { BUN_JSC_markedBlockCageSizeInMB: "64" })),
      }).toEqual({
        step,
        stdout: "0 true true\n1 true true\n2 true true\nafterward, the library's handler ran 0 times\n",
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
  }, 120_000);

  test("in a worker while a library sets one action after another", async () => {
    using directory = tempDir("aot-a-worker-reads-while-a-library-sets", {
      "main.ts": aWorkerReadsAllTheWhile,
      "library.c": library,
    });
    const [executable, path] = await Promise.all([
      build(String(directory), "main.ts"),
      buildLibrary(String(directory)),
    ]);
    expect(await run([executable, path], String(directory))).toEqual({
      stdout: "done, the library's handler ran 0 times\n",
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  }, 120_000);
});
