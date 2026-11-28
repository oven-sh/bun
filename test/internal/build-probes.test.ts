/**
 * What configure does with a program that gives no answer (scripts/build/probe.ts).
 *
 * Configure asks programs questions: `clang --version`, `clang -print-resource-dir`, `brew --prefix`,
 * `git rev-parse HEAD`. A program that ran out of time, or that a signal killed, has said nothing. Tool discovery
 * used to read that as "this is not the clang": on a busy machine `clang --version` missed its 30 seconds, the
 * search went on to `clang-23`, a symlink to the same binary, and the new compiler path in build.ninja recompiled
 * every C file and every Rust crate. Now an ask without an answer fails configure, and only an answer moves a
 * search on.
 *
 * The programs are shell scripts. One that kills itself stands for one that the timer killed: both end without an
 * exit status, and only the tests of the timer wait for it.
 */
import { expect, spyOn, test } from "bun:test";
import { bunExe, type DirectoryTree, isLinux, isWindows, tempDir } from "harness";
import { chmodSync, existsSync, readFileSync, realpathSync, symlinkSync } from "node:fs";
import { join } from "node:path";

import { pins } from "../../scripts/build/ci-images/spec.ts";
import { type Config, resolveCodegenConfig } from "../../scripts/build/config.ts";
import { ninjaIfPresent } from "../../scripts/build/ninja-release.ts";
import { ask, NoAnswer, printed } from "../../scripts/build/probe.ts";
import {
  checkImageTools,
  findTool,
  LLVM_VERSION,
  resolveLlvmToolchain,
  toolchainOverride,
  toolIdentity,
  toolIdentityFile,
  writeToolIdentities,
} from "../../scripts/build/tools.ts";

/** A stand-in that answers every question with `lines`. */
const answers = (...lines: string[]) => `#!/bin/sh\n${lines.map(l => `echo '${l}'`).join("\n")}\n`;
/** Ends a stand-in without an exit status. `kill` is not a builtin of every shell, and some tests leave no PATH. */
const dies = "PATH=/bin:/usr/bin\nkill -KILL $$";
const killed = `#!/bin/sh\n${dies}\n`;
/** A stand-in that leaves each question in `<itself>.asked`, and then does `answer`. */
const recording = (answer: string) => `#!/bin/sh\necho "$1" >> "$0.asked"\n${answer}\n`;
const asked = (standIn: string) => (existsSync(`${standIn}.asked`) ? readFileSync(`${standIn}.asked`, "utf8") : "");
/** The next name in a search for clang. */
const nextName = recording("echo 'clang version 23.1.1'");

/** A directory of stand-ins, by relative path. */
function standIns(name: string, programs: DirectoryTree) {
  const dir = tempDir(name, programs);
  for (const program of Object.keys(programs)) chmodSync(join(String(dir), program), 0o755);
  return dir;
}

/** How tool discovery looks for clang: the plain name, then the name a distro gives one release. */
const clangIn = (...dirs: string[]) => ({
  names: ["clang", "clang-23"],
  paths: dirs,
  pathsOnly: true,
  version: ">=23.1.0 <23.1.99",
  required: true,
});

/** The message of the NoAnswer that `question` throws, or what it did instead. */
function noAnswer(question: () => unknown): string {
  try {
    return `returned ${JSON.stringify(question())}`;
  } catch (error) {
    return error instanceof NoAnswer ? error.message : `threw ${error}`;
  }
}

/** `body`, with these variables set, or unset where the value is undefined, while it runs. */
function withEnv<T>(variables: Record<string, string | undefined>, body: () => T): T {
  const set = (to: Record<string, string | undefined>) => {
    for (const [name, value] of Object.entries(to)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
  const before = Object.fromEntries(Object.keys(variables).map(name => [name, process.env[name]]));
  set(variables);
  try {
    return body();
  } finally {
    set(before);
  }
}

test.skipIf(isWindows)("a tool that gives no answer ends the search: the next name is not asked", () => {
  using dir = standIns("probe-no-answer", {
    "killed/clang": killed,
    "killed/clang-23": nextName,
    // It printed its version, but it did not exit: that is no answer either.
    "killed-after-it-printed/clang": `#!/bin/sh\necho 'clang version 23.1.1'\n${dies}\n`,
    "killed-after-it-printed/clang-23": nextName,
  });
  for (const [name, printed] of [
    ["killed", ""],
    ["killed-after-it-printed", ", after it printed: clang version 23.1.1"],
  ]) {
    const bin = join(String(dir), name);
    expect(noAnswer(() => findTool(clangIn(bin)))).toBe(
      `\`${join(bin, "clang")} --version\` was killed by SIGKILL${printed}`,
    );
    expect(asked(join(bin, "clang-23"))).toBe("");
  }
});

test.skipIf(isWindows)(
  "a tool that answers, or that the machine will not run, is passed over for the next name",
  () => {
    using dir = standIns("probe-answer", {
      "another-version/clang": answers("clang version 17.0.6"),
      "another-version/clang-23": nextName,
      // Three files that the machine does not run: no such interpreter, an interpreter that is no program, and the
      // start of a program for no machine.
      "no-interpreter/clang": "#!/no/such/interpreter\n",
      "no-interpreter/clang-23": nextName,
      "interpreter-is-a-file/clang": ({ root }) => `#!${join(root, "a-file")}\n`,
      "interpreter-is-a-file/clang-23": nextName,
      "a-file": "",
      "not-a-program/clang": Buffer.from("\x7fELF\0\0\0\0", "latin1"),
      "not-a-program/clang-23": nextName,
      // It failed to load. The version in the library's name is not the version of clang.
      "failed-to-load/clang": `#!/bin/sh\necho "$0: error while loading shared libraries: libLLVM.so.23.1.1" >&2\nexit 127\n`,
      "failed-to-load/clang-23": nextName,
    });
    chmodSync(join(String(dir), "a-file"), 0o644);
    for (const name of [
      "another-version",
      "no-interpreter",
      "interpreter-is-a-file",
      "not-a-program",
      "failed-to-load",
    ]) {
      const bin = join(String(dir), name);
      expect(findTool(clangIn(bin))).toMatchObject({ path: join(bin, "clang-23"), version: "23.1.1" });
    }
  },
);

test.skipIf(isWindows)("a tool that failed is asked again where the search comes to it again", () => {
  using dir = standIns("probe-again", {
    "clang": `#!/bin/sh\nif [ ! -e "$0.failed" ]; then : > "$0.failed"; exit 127; fi\necho 'clang version 23.1.1'\n`,
    "clang-23": nextName,
  });
  const bin = String(dir);
  // One directory is in the search twice where it is a known LLVM location and is on PATH too.
  expect(findTool(clangIn(bin, bin))).toMatchObject({ path: join(bin, "clang"), version: "23.1.1" });
  expect(asked(join(bin, "clang-23"))).toBe("");
});

test.skipIf(isWindows)("a tool that runs out of time has given no answer", () => {
  using dir = standIns("probe-budget", {
    "hangs": "#!/bin/sh\nexec sleep 60\n",
    // SIGTERM does not end this one. If the timer left it alive, it would say so two seconds later.
    "ignores-sigterm": `#!/bin/sh\ntrap '' TERM\nsleep 2 >/dev/null 2>&1\n: > "$0.outlived-the-timer"\n`,
  });
  const hangs = join(String(dir), "hangs");
  let error: unknown;
  try {
    ask(hangs, ["--version"], { budgetMs: 50 });
  } catch (thrown) {
    error = thrown;
  }
  expect(error).toBeInstanceOf(NoAnswer);
  expect({
    message: (error as NoAnswer).message,
    cause: ((error as NoAnswer).cause as NodeJS.ErrnoException).code,
  }).toEqual({
    message: `\`${hangs} --version\` did not answer in 0.05s`,
    cause: "ETIMEDOUT",
  });

  // The ask returns when the timer ends the program, not when the program chooses to end.
  const ignores = join(String(dir), "ignores-sigterm");
  expect(noAnswer(() => ask(ignores, [], { budgetMs: 50 }))).toBe(`\`${ignores}\` did not answer in 0.05s`);
  expect(existsSync(`${ignores}.outlived-the-timer`)).toBe(false);
});

// The codes are what this kernel says, so the test is for this kernel.
test.skipIf(!isLinux)("what the machine says about the file is an answer, and another failure to start is none", () => {
  using dir = standIns("probe-start", {
    "tool": answers("ok"),
    "a-file": "",
  });
  const root = String(dir);
  chmodSync(join(root, "a-file"), 0o644);
  symlinkSync("a-link-to-itself", join(root, "a-link-to-itself"));
  const cannotRun = (exe: string) => {
    const answer = ask(exe, [], { budgetMs: 60_000 });
    return "cannotRun" in answer ? answer.cannotRun.code : answer;
  };
  expect({
    "no file": cannotRun(join(root, "missing")),
    "under a file": cannotRun(join(root, "a-file", "bin", "rustc")),
    "a link to itself": cannotRun(join(root, "a-link-to-itself")),
    "a name too long": cannotRun(join(root, Buffer.alloc(300, "n").toString())),
    "no execute bit": cannotRun(join(root, "a-file")),
  }).toEqual({
    "no file": "ENOENT",
    "under a file": "ENOTDIR",
    "a link to itself": "ELOOP",
    "a name too long": "ENAMETOOLONG",
    "no execute bit": "EACCES",
  });

  // More arguments than a program can be started with: that says nothing about the file.
  let error: unknown;
  try {
    ask(join(root, "tool"), [Buffer.alloc(3_000_000, "x").toString()], { budgetMs: 60_000 });
  } catch (thrown) {
    error = thrown;
  }
  expect(error).toBeInstanceOf(NoAnswer);
  expect(((error as NoAnswer).cause as NodeJS.ErrnoException).code).toBe("E2BIG");
});

// On every platform: the program is this Bun.
test("an ask gives what the program printed and how it exited", () => {
  using dir = tempDir("probe-bun", {});
  const answer = ask(bunExe(), ["-e", "console.log(process.env.ASKED); process.exit(5)"], {
    budgetMs: 60_000,
    env: { ASKED: "in its environment", BUN_DEBUG_QUIET_LOGS: "1" },
  });
  expect(answer).toMatchObject({ status: 5, stdout: "in its environment\n" });
  expect(printed(answer)).toBeUndefined();
  expect(printed({ status: 0, stdout: "printed", stderr: "" })).toBe("printed");

  const missing = ask(join(String(dir), "no-such-program"), [], { budgetMs: 60_000 });
  expect("cannotRun" in missing ? missing.cannotRun.code : missing).toBe("ENOENT");
  expect(printed(missing)).toBeUndefined();

  const forever = "setInterval(() => {}, 1000)";
  expect(noAnswer(() => ask(bunExe(), ["-e", forever], { budgetMs: 50 }))).toBe(
    `\`${bunExe()} -e ${forever}\` did not answer in 0.05s`,
  );
});

test.skipIf(isWindows)("an ask that took five seconds says so, and a shorter one says nothing", () => {
  using dir = standIns("probe-slow", { "clang": answers("clang version 23.1.1") });
  const clang = join(String(dir), "clang");
  const stderr = spyOn(process.stderr, "write").mockImplementation(() => true);
  // `ask()` reads the clock before and after. The test says how far apart, so a busy machine says nothing here.
  let step = 0;
  let now = 0;
  const clock = spyOn(performance, "now").mockImplementation(() => (now += step));
  const saidAfter = (milliseconds: number) => {
    stderr.mockClear();
    step = milliseconds;
    ask(clang, ["--version"], { budgetMs: 60_000 });
    return stderr.mock.calls.map(call => String(call[0])).join("");
  };
  try {
    expect([saidAfter(4999), saidAfter(5000)]).toEqual(["", `\`${clang} --version\` took 5s to answer\n`]);
  } finally {
    clock.mockRestore();
    stderr.mockRestore();
  }
});

test.skipIf(isWindows)("a tool's identity and the CI image check fail the same way without an answer", () => {
  using dir = standIns("probe-askers", { "tool": killed });
  const tool = join(String(dir), "tool");
  const message = `\`${tool} --version\` was killed by SIGKILL`;
  expect(noAnswer(() => toolIdentity(tool))).toBe(message);
  expect(noAnswer(() => checkImageTools({ bun: tool, cmake: tool, clangVersion: undefined }))).toBe(message);
});

/**
 * An LLVM as BUN_TOOLCHAIN_LLVM names one: `bin/` with clang, clang++ and ld.lld, which answer and record what
 * they were asked, and the tools that are only looked for.
 */
const llvm = (resourceDir: string) => ({
  "bin/clang": recording(
    `case "$1" in\n  --version) echo 'clang version ${LLVM_VERSION}'; echo 'Target: aarch64-unknown-linux-gnu' ;;\n  -print-resource-dir) ${resourceDir} ;;\nesac`,
  ),
  "bin/clang++": recording(`echo 'clang version ${LLVM_VERSION}'`),
  "bin/ld.lld": recording(`echo 'LLD ${LLVM_VERSION} (compatible with GNU linkers)'`),
  "bin/llvm-ar": "",
  "bin/strip": "",
});

/** Tool discovery on a Linux host whose LLVM is `root`, with nothing else of this machine: no rustc, no other PATH. */
function discoverIn(root: string, target: "linux" | "darwin") {
  const named = toolchainOverride.llvm;
  toolchainOverride.llvm = root;
  try {
    return withEnv({ PATH: join(root, "bin"), CARGO_HOME: root }, () => resolveLlvmToolchain("linux", "x64", target));
  } finally {
    toolchainOverride.llvm = named;
  }
}

test.skipIf(isWindows)("what tool discovery asked a tool is not asked again for its identity or its target", () => {
  using dir = standIns("probe-once", llvm("echo /the/resource/dir"));
  const bin = join(String(dir), "bin");
  const toolchain = discoverIn(String(dir), "linux");
  expect(toolchain).toMatchObject({
    cc: join(bin, "clang"),
    clangVersion: LLVM_VERSION,
    clangTargetArch: "aarch64",
    // Only a macOS target on another host reads it, so only that build asks.
    clangResourceDir: undefined,
  });

  const cfg = {
    buildDir: join(String(dir), "build"),
    cc: toolchain.cc,
    cxx: toolchain.cxx,
    hostCc: toolchain.cc,
    ld: toolchain.ld,
  } as Config;
  writeToolIdentities(cfg, toolchain.toolIdentities);
  expect(
    (["cc", "cxx", "hostCc", "ld"] as const).map(tool => readFileSync(toolIdentityFile(cfg, tool), "utf8")),
  ).toEqual([
    `clang version ${LLVM_VERSION}\n`,
    `clang version ${LLVM_VERSION}\n`,
    `clang version ${LLVM_VERSION}\n`,
    `LLD ${LLVM_VERSION} (compatible with GNU linkers)\n`,
  ]);
  expect({ "clang": asked(toolchain.cc), "clang++": asked(toolchain.cxx), "ld.lld": asked(toolchain.ld) }).toEqual({
    "clang": "--version\n",
    "clang++": "--version\n",
    "ld.lld": "--version\n",
  });
});

test.skipIf(isWindows)("the resource directory of clang is asked for a macOS target on another host", () => {
  const under = (name: string, tree: Record<string, string>) =>
    Object.fromEntries(Object.entries(tree).map(([path, text]) => [`${name}/${path}`, text]));
  using dir = standIns("probe-resource-dir", {
    ...under("answers", llvm("echo /the/resource/dir")),
    ...under("fails", llvm("echo /the/resource/dir; exit 1")),
    ...under("killed", llvm(dies.replace("\n", "; "))),
  });
  const clang = (name: string) => join(String(dir), name, "bin", "clang");

  expect(discoverIn(join(String(dir), "answers"), "darwin").clangResourceDir).toBe("/the/resource/dir");
  expect(asked(clang("answers"))).toBe("--version\n-print-resource-dir\n");
  expect(discoverIn(join(String(dir), "fails"), "darwin").clangResourceDir).toBeUndefined();
  expect(noAnswer(() => discoverIn(join(String(dir), "killed"), "darwin"))).toBe(
    `\`${clang("killed")} -print-resource-dir\` was killed by SIGKILL`,
  );
});

// `brew --prefix` is asked where brew is not at the prefix Homebrew gives the architecture. A host of either
// architecture has at most one of the two, so the test names the other.
const arch = (["aarch64", "x64"] as const).find(
  it => !existsSync(join(it === "aarch64" ? "/opt/homebrew" : "/usr/local", "bin", "brew")),
);

test.skipIf(isWindows || arch === undefined)("a brew that gives no answer has not named a prefix", () => {
  const keg = `prefix/opt/llvm@${LLVM_VERSION.split(".")[0]}/bin`;
  /** A macOS host whose LLVM is under the prefix that its brew prints. */
  const host = (name: string, brew: (prefix: string) => string) => ({
    [`${name}/path/brew`]: ({ root }: { root: string }) => brew(join(root, name, "prefix")),
    [`${name}/${keg}/clang`]: answers(`clang version ${LLVM_VERSION}`),
    // Looked for, never asked.
    ...Object.fromEntries(["clang++", "llvm-ar", "llvm-strip", "dsymutil"].map(tool => [`${name}/${keg}/${tool}`, ""])),
  });
  using dir = standIns("probe-brew", {
    ...host("answers", prefix => answers(prefix)),
    ...host("fails", prefix => `#!/bin/sh\necho '${prefix}'\nexit 1\n`),
    ...host("killed", () => killed),
  });
  const clang = (name: string) => join(String(dir), name, keg, "clang");
  /** The clang of a host: under its brew's prefix, or wherever else this machine has one, or why there is none. */
  const cc = (name: string) => {
    const named = toolchainOverride.llvm;
    toolchainOverride.llvm = undefined;
    try {
      // Nothing of this machine on PATH but the host's brew, and no rustc.
      const env = { PATH: join(String(dir), name, "path"), CARGO_HOME: join(String(dir), name) };
      return withEnv(env, () => resolveLlvmToolchain("darwin", arch!)).cc;
    } catch (error) {
      return (error as Error).message;
    } finally {
      toolchainOverride.llvm = named;
    }
  };

  expect(cc("answers")).toBe(clang("answers"));
  // It printed a prefix and failed: that is an answer, and the answer is not a prefix. What is found instead is this
  // machine's LLVM or none, and nothing of the host that brew named.
  expect(cc("fails")).not.toContain(String(dir));
  expect(cc("killed")).toBe("`brew --prefix` was killed by SIGKILL");
});

test.skipIf(isWindows)("a git that was killed has not said that there is no commit", () => {
  using dir = standIns("probe-git", {
    // It is asked in the checkout, and this one answers with where that is.
    "answers/git": "#!/bin/sh\npwd -P\n",
    "no-repository/git": "#!/bin/sh\nexit 128\n",
    "killed/git": killed,
  });
  const checkout = realpathSync(join(import.meta.dir, "..", ".."));
  const js = { bun: "/fake/bun", jsRuntime: "/fake/bun", esbuild: "/fake/esbuild" };
  // A release build asks git on every configure, where no CI names the commit.
  const revision = (name: string) => {
    const cwd = process.cwd();
    // Configure finds the checkout from any directory in it.
    process.chdir(join(checkout, "scripts"));
    try {
      return withEnv(
        { PATH: join(String(dir), name), BUILDKITE_COMMIT: undefined, GITHUB_SHA: undefined, GIT_SHA: undefined },
        () => resolveCodegenConfig({ mode: "codegen", buildType: "Release" }, js).revision,
      );
    } finally {
      process.chdir(cwd);
    }
  };

  expect(revision("answers")).toBe(checkout);
  expect(revision("no-repository")).toBe("unknown");
  expect(noAnswer(() => revision("killed"))).toBe("`git rev-parse HEAD` was killed by SIGKILL");
});

test.skipIf(isWindows)("the pinned ninja that this machine does not run is replaced out loud", () => {
  const pinned = join("ninja", pins.bunNinja.tag, "ninja");
  // No execute bit: the machine does not run it.
  using dir = tempDir("probe-ninja", { [pinned]: "" });
  const stderr = spyOn(process.stderr, "write").mockImplementation(() => true);
  let ninja: string;
  let said: string;
  try {
    // No CI image has a ninja for FreeBSD, so the build cache is where this host's is.
    ninja = ninjaIfPresent({ cacheDir: String(dir), host: { os: "freebsd", arch: "x64", exeSuffix: "" } });
    said = stderr.mock.calls.map(call => String(call[0])).join("");
  } finally {
    stderr.mockRestore();
  }
  expect(said).toContain(`${join(String(dir), pinned)} cannot run on this machine (`);
  expect(said).toContain("EACCES");
  expect(said).toContain("); building with the ninja on PATH, without Rust pipelining\n");
  expect(ninja).toBe("ninja");
});
