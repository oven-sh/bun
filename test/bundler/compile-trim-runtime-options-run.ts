import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { slot, unsupported } from "../aot/run-programs";

const source = readFileSync(join(import.meta.dir, "../../src/runtime/cli/Arguments.rs"), "utf8");

function specsIn(table: string): string[] {
  const body = new RegExp(`const ${table}: &\\[ParamType\\] =([^]*?)^[)\\]]*;$`, "m").exec(source)?.[1];
  if (body === undefined) throw new Error(`src/runtime/cli/Arguments.rs has no table ${table}`);
  const specs: string[] = [];
  const parts = /parse_param!\(\s*"((?:[^"\\]|\\.)*)"|\b([A-Z_]+_PARAMS_?)\b|(maybe_debug_params)!/g;
  for (const [, spec, otherTable, debug] of body.replace(/^\s*\/\/.*$/gm, "").matchAll(parts)) {
    if (spec !== undefined) specs.push(spec);
    else specs.push(...specsIn(debug ? "DEBUG_PARAMS" : otherTable));
  }
  return specs;
}

export const namesInTheSource = specsIn("AUTO_PARAMS")
  .flatMap(spec => {
    const [, short, long] = /^(?:-(\w)(?:, )?)?(?:--([\w.-]+))?/.exec(spec)!;
    return [long && "--" + long, short && "-" + short].filter(name => name !== undefined);
  })
  .sort();

const themselves = (names: string) => Object.fromEntries(names.split(" ").map(name => [name, [name]]));

export const obeyed: Record<string, string[]> = {
  ...themselves("--silent --version -v --revision --bun -b --no-orphans --workspaces --parallel --sequential --no-exit-on-error"),
  ...themselves("--watch --hot --no-clear-screen --check --smol --aot-huge-heap --debug-aot --aot-crash-if-interpreter-is-used --interactive"),
  ...themselves("--if-present --no-install --prefer-offline --prefer-latest --experimental-http2-fetch --experimental-http3-fetch"),
  ...themselves("--insecure-http-parser --experimental-stream-iter --expose-gc --no-deprecation --throw-deprecation --no-warnings"),
  ...themselves("--trace-warnings --trace-deprecation --pending-deprecation --zero-fill-buffers --use-system-ca --use-openssl-ca --use-bundled-ca"),
  ...themselves("--tls-min-v1.0 --tls-min-v1.1 --tls-min-v1.2 --tls-min-v1.3 --tls-max-v1.2 --tls-max-v1.3 --no-addons --no-ffi-cc"),
  ...themselves("--expose-internals --preserve-symlinks --preserve-symlinks-main --no-macros --jsx-side-effects --ignore-dce-annotations --no-env-file"),
  "--elide-lines": ["--elide-lines=3"],
  "--filter": ["--filter=x"],
  "-F": ["-F=x", "-F x"],
  "--shell": ["--shell=bun", "--shell=system"],
  "--watch-kill-signal": ["--watch-kill-signal=SIGTERM"],
  "--aot-type-errors": ["--aot-type-errors=log", "--aot-type-errors=throw", "--aot-type-errors=nonsense"],
  "--aot-graph-fd": ["--aot-graph-fd=9"],
  "--aot-decode-crash-report": ["--aot-decode-crash-report=x"],
  "--inspect": ["--inspect", "--inspect=127.0.0.1:0"],
  "--inspect-wait": ["--inspect-wait=127.0.0.1:0"],
  "--inspect-brk": ["--inspect-brk=127.0.0.1:0"],
  "--cpu-prof": ["--cpu-prof --cpu-prof-dir=profiles --cpu-prof-name=a.cpuprofile"],
  "--cpu-prof-md": ["--cpu-prof-md --cpu-prof-dir=profiles --cpu-prof-name=b.md"],
  "--cpu-prof-name": ["--cpu-prof-name=x"],
  "--cpu-prof-dir": ["--cpu-prof-dir=profiles"],
  "--cpu-prof-interval": ["--cpu-prof-interval=100", "--cpu-prof --cpu-prof-dir=profiles --cpu-prof-name=c.cpuprofile --cpu-prof-interval=500"],
  "--heap-prof": ["--heap-prof --heap-prof-dir=profiles --heap-prof-name=d.heapprofile"],
  "--heap-prof-md": ["--heap-prof-md --heap-prof-dir=profiles --heap-prof-name=e.md"],
  "--heap-prof-name": ["--heap-prof-name=x"],
  "--heap-prof-dir": ["--heap-prof-dir=profiles"],
  "--heap-prof-interval": ["--heap-prof-interval=100", "--heap-prof --heap-prof-dir=profiles --heap-prof-name=f.heapprofile --heap-prof-interval=1024"],
  "--port": ["--port=4000"],
  "--origin": ["--origin=http://localhost"],
  "-u": ["-u=http://localhost"],
  "--conditions": ["--conditions=x"],
  "--max-http-header-size": ["--max-http-header-size=100", "--max-http-header-size=nonsense"],
  "--dns-result-order": ["--dns-result-order=ipv4first", "--dns-result-order=ipv6first", "--dns-result-order=verbatim", "--dns-result-order=nonsense"],
  "--redirect-warnings": ["--redirect-warnings=warnings.txt"],
  "--disable-warning": ["--disable-warning=x"],
  "--title": ["--title=x", "--title x", "--title 'two words'"],
  "--disallow-code-generation-from-strings": [
    "--disallow-code-generation-from-strings",
    "--disallow-code-generation-from-strings=strict",
    "--disallow-code-generation-from-strings=nonsense",
  ],
  "--unhandled-rejections": ["--unhandled-rejections=strict", "--unhandled-rejections=none", "--unhandled-rejections=nonsense"],
  "--console-depth": ["--console-depth=3", "--console-depth=nonsense"],
  "--user-agent": ["--user-agent=x"],
  "--cron-title": ["--cron-title=x", "--cron-title=x --cron-period=hourly"],
  "--cron-period": ["--cron-period=hourly"],
  "--main-fields": ["--main-fields=x"],
  "--extension-order": ["--extension-order=.ts"],
  "--tsconfig-override": ["--tsconfig-override=tsconfig.other.json", "--tsconfig-override=none.json"],
  "--define": ["--define=a:1"],
  "-d": ["-d=a:1", "-d a:1"],
  "--drop": ["--drop=console"],
  "--feature": ["--feature=x"],
  "--loader": ["--loader=.x:ts", "--loader=nonsense"],
  "-l": ["-l=.x:ts"],
  "--jsx-factory": ["--jsx-factory=h"],
  "--jsx-fragment": ["--jsx-fragment=f"],
  "--jsx-import-source": ["--jsx-import-source=x"],
  "--jsx-runtime": ["--jsx-runtime=classic", "--jsx-runtime=nonsense"],
  "--breakpoint-resolve": ["--breakpoint-resolve=x"],
  "--env-file": ["--env-file=other.env", "--env-file=none.env"],
  "--cwd": ["--cwd=sub", "--cwd=none"],
  "--config": ["--config=own.toml", "--config=none.toml"],
  "-c": ["-c=own.toml", "-c=none.toml"],
};

const neverEnd = ["--watch", "--hot", "--redis-preconnect"];

export const leftOut: Record<string, string[]> = {
  ...themselves("--trace-env --trace-env-js-stack --trace-env-native-stack --trace-exit --trace-events-enabled --sql-preconnect --help -h --aot --aot-audit"),
  "--stack-trace-limit": ["--stack-trace-limit=3", "--stack-trace-limit 3"],
  "--trace-event-categories": ["--trace-event-categories=node", "--trace-event-categories node"],
  "--trace-event-file-pattern": ["--trace-event-file-pattern=trace.log"],
};
const isLeftOut = "cannot be used with this executable: the part of Bun that it needs was left out when it was built";

export const loadCode: Record<string, string[]> = {
  "--preload": ["--preload=./preloaded.ts", "--preload ./preloaded.ts"],
  "-r": ["-r=./preloaded.ts", "-r ./preloaded.ts"],
  "--require": ["--require=./preloaded.ts"],
  "--import": ["--import=./preloaded.ts"],
  "--eval": ["--eval=1"],
  "-e": ["-e=1", "-e 1"],
  "--print": ["--print=1"],
  "-p": ["-p=1", "-p 1"],
};
export const obeyedWhereTheProgramUsesThePart: Record<string, { forms: string[]; program: string }> = {
  "--fetch-preconnect": { forms: ["--fetch-preconnect=http://127.0.0.1:9", "--fetch-preconnect http://127.0.0.1:9"], program: "names-fetch.ts" },
  "--redis-preconnect": { forms: ["--redis-preconnect"], program: "names-redis.ts" },
};
export const obeyedWhereThePartIsKept: Record<string, { forms: string[]; keep: Bun.Build.TrimFeature }> = {
  "-i": { forms: ["-i"], keep: "install" },
  "--install": { forms: ["--install=auto", "--install=force", "--install=fallback", "--install=nonsense"], keep: "install" },
};

const loadsCode = "cannot be used with this executable: it was built with --compile-trim-runtime and runs only the code that was compiled into it";

const files = {
  "hello.ts": `console.log("hello world");`,
  "names-fetch.ts": `console.log("hello world", typeof fetch);`,
  "names-redis.ts": `console.log("hello world", typeof Bun.RedisClient);`,
  "preloaded.ts": `console.log("preloaded");`,
  "other.env": "FROM_A_FILE=1\n",
  "own.toml": "[console]\ndepth = 1\n",
  "tsconfig.other.json": "{}",
  "sub/keep": "",
};

using probe = tempDir("compile-trim-runtime-options-probe", { "hello.ts": files["hello.ts"] });
const probed = Bun.spawnSync({
  cmd: [bunExe(), "build", "--compile", "--compile-trim-runtime", "hello.ts", "--outfile", "hello"],
  cwd: String(probe),
  env: bunEnv,
  stdout: "pipe",
  stderr: "pipe",
});
const hasIslands = !probed.stderr.toString().includes("nothing can be left out of this Bun");

type Side = "whole" | "trimmed";
const flagsOf = { whole: [], trimmed: ["--compile-trim-runtime"] };

function laidOut(root: string, side: Side) {
  const folder = join(root, side);
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), contents);
  }
  return folder;
}

async function spawned(cmd: string[], folder: string, env: Record<string, string | undefined>, timeout: number) {
  await using child = Bun.spawn({ cmd, cwd: folder, env, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout, killSignal: "SIGKILL" });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  const said = (text: string) => text.replaceAll(folder, "<folder>").replaceAll("program.exe", "program");
  return { stdout: said(stdout), stderr: said(stderr), exitCode: child.signalCode ?? exitCode };
}

const builtInThisTurn = (folder: string, side: Side, flags: string[] = [], program = "hello.ts") =>
  spawned([bunExe(), "build", "--compile", "--aot", ...flagsOf[side], ...flags, program, "--outfile", "program"], folder, bunEnv, 90_000);
const built = (...build: Parameters<typeof builtInThisTurn>) => slot(() => builtInThisTurn(...build));

const builtKeeping = (folder: string, keep: Bun.Build.TrimFeature, execArgv: string[] = []) =>
  slot(() => Bun.build({ entrypoints: [join(folder, "hello.ts")], compile: { outfile: join(folder, "program"), aot: true, trim: { keep: [keep] }, execArgv } }));

const eachLineOnce = (text: string) => [...new Set(text.split("\n"))].join("\n");

async function started(folder: string, name: string, options?: string, args: string[] = []) {
  const cmd = [join(folder, "program"), ...args];
  if (!neverEnd.includes(name)) return await spawned(cmd, folder, { ...bunEnv, BUN_OPTIONS: options }, 60_000);
  const killed = await spawned(cmd, folder, { ...bunEnv, BUN_OPTIONS: options }, 5_000);
  return { ...killed, stdout: eachLineOnce(killed.stdout), stderr: eachLineOnce(killed.stderr) };
}

const formsOf = (sorted: Record<string, string[]>) => Object.entries(sorted).flatMap(([name, forms]) => forms.map(form => [name, form] as const));
const formsByUse = Object.entries(obeyedWhereTheProgramUsesThePart).flatMap(([name, { forms, program }]) => forms.map(form => [name, form, program] as const));
const formsByKeeping = Object.entries(obeyedWhereThePartIsKept).flatMap(([name, { forms, keep }]) => forms.map(form => [name, form, keep] as const));

export function testTheSorting() {
  test("every option that a compiled executable reads is sorted: obeyed as in the whole executable, or refused", () => {
    const sorted = [obeyed, obeyedWhereTheProgramUsesThePart, obeyedWhereThePartIsKept, leftOut, loadCode].flatMap(Object.keys).sort();
    expect(sorted).toEqual(namesInTheSource);
  });
}

export function testBunOptions() {
  if (!hasIslands || unsupported) return test.skip("BUN_OPTIONS, in an executable built with --compile-trim-runtime", () => {});

  describe.concurrent("BUN_OPTIONS, in an executable built with --compile-trim-runtime", () => {
    const dir = tempDir("compile-trim-runtime-options", {});
    afterAll(() => dir[Symbol.dispose]());
    const root = realpathSync(String(dir));
    const whole = laidOut(root, "whole");
    const trimmed = laidOut(root, "trimmed");
    let folders = 0;

    beforeAll(async () => {
      expect(await Promise.all([built(whole, "whole"), built(trimmed, "trimmed")])).toMatchObject([{ exitCode: 0 }, { exitCode: 0 }]);
    });

    test.each(formsOf(obeyed))("%s is obeyed: %s", async (name, form) => {
      expect(await started(trimmed, name, form)).toEqual(await started(whole, name, form));
    });

    test.each(formsOf(leftOut))("%s is refused: %s", async (name, form) => {
      expect(await started(trimmed, name, form)).toEqual({ stdout: "", stderr: `error: ${name} ${isLeftOut}\n`, exitCode: 1 });
    });

    test.each(formsOf(loadCode))("%s is refused: %s", async (name, form) => {
      expect(await started(trimmed, name, form)).toEqual({ stdout: "", stderr: `error: ${name} ${loadsCode}\n`, exitCode: 1 });
    });

    test.each(formsByUse)("%s is refused where the program does not use what it connects for: %s", async (name, form) => {
      expect(await started(trimmed, name, form)).toEqual({ stdout: "", stderr: `error: ${name} ${isLeftOut}\n`, exitCode: 1 });
    });

    test.each(formsByUse)("%s is obeyed where it does: %s, %s", async (name, form, program) => {
      const folder = join(root, String(folders++));
      const sides = [laidOut(folder, "whole"), laidOut(folder, "trimmed")];
      expect(await Promise.all([built(sides[0], "whole", [], program), built(sides[1], "trimmed", [], program)])).toMatchObject([{ exitCode: 0 }, { exitCode: 0 }]);
      expect(await started(sides[1], name, form)).toEqual(await started(sides[0], name, form));
    });

    test.each(formsByKeeping)("%s is refused where the part that it needs is left out: %s", async (name, form) => {
      expect(await started(trimmed, name, form)).toEqual({ stdout: "", stderr: `error: ${name} ${isLeftOut}\n`, exitCode: 1 });
    });

    test.each(formsByKeeping)("%s is obeyed where compile.trim keeps that part: %s, %s", async (name, form, keep) => {
      const folder = laidOut(join(root, String(folders++)), "trimmed");
      await builtKeeping(folder, keep);
      expect(await started(folder, name, form)).toEqual(await started(whole, name, form));
    });

    test("behind the name of the executable they all belong to the program", async () => {
      const args = [...[obeyed, leftOut, loadCode].flatMap(formsOf), ...formsByUse, ...formsByKeeping].flatMap(([, form]) => form.split(" "));
      expect(await started(trimmed, "", undefined, args)).toEqual({ stdout: "hello world\n", stderr: "", exitCode: 0 });
    });
  });
}

export function testExecArgv(part: number, parts: number) {
  const inThisPart = <T>(forms: T[]) => forms.filter((_, index) => index % parts === part - 1);

  if (!hasIslands || unsupported) return test.skip("--compile-exec-argv with --compile-trim-runtime", () => {});

  describe.concurrent("--compile-exec-argv with --compile-trim-runtime", () => {
    const dir = tempDir("compile-trim-runtime-exec-argv", {});
    afterAll(() => dir[Symbol.dispose]());
    const root = realpathSync(String(dir));
    let folders = 0;

    async function builtWith(side: Side, form: string, program?: string, build = built) {
      const folder = laidOut(join(root, String(folders++)), side);
      return { folder, build: await build(folder, side, ["--compile-exec-argv=" + form], program), [Symbol.dispose]: () => rmSync(folder, { recursive: true, force: true }) };
    }

    const builtBothWaysWith = (form: string, program?: string) =>
      slot(async () => [await builtWith("whole", form, program, builtInThisTurn), await builtWith("trimmed", form, program, builtInThisTurn)] as const);

    test.each(inThisPart(formsOf(obeyed)))("%s is obeyed: %s", async (name, form) => {
      const both = await builtBothWaysWith(form);
      using whole = both[0];
      using trimmed = both[1];
      expect([whole.build, trimmed.build]).toMatchObject([{ exitCode: 0 }, { exitCode: 0 }]);
      expect(await started(trimmed.folder, name)).toEqual(await started(whole.folder, name));
    });

    test.each(inThisPart(formsOf(leftOut)))("%s is refused by the build: %s", async (name, form) => {
      using trimmed = await builtWith("trimmed", form);
      expect(trimmed.build).toEqual({ stdout: "", stderr: `error: ${name} ${isLeftOut}\n`, exitCode: 1 });
      expect(await Bun.file(join(trimmed.folder, isWindows ? "program.exe" : "program")).exists()).toBe(false);
    });

    test.each(inThisPart(formsByUse))("%s is refused by the build where the program does not use what it connects for: %s", async (name, form) => {
      using trimmed = await builtWith("trimmed", form);
      expect(trimmed.build.stderr).toEndWith(`error: ${name} ${isLeftOut}\n`);
      expect(trimmed.build.exitCode).toBe(1);
      expect(await Bun.file(join(trimmed.folder, isWindows ? "program.exe" : "program")).exists()).toBe(false);
    });

    test.each(inThisPart(formsByUse))("%s is obeyed where it does: %s, %s", async (name, form, program) => {
      const both = await builtBothWaysWith(form, program);
      using whole = both[0];
      using trimmed = both[1];
      expect([whole.build, trimmed.build]).toMatchObject([{ exitCode: 0 }, { exitCode: 0 }]);
      expect(await started(trimmed.folder, name)).toEqual(await started(whole.folder, name));
    });

    test.each(inThisPart(formsByKeeping))("%s is refused by the build where the part that it needs is left out: %s", async (name, form) => {
      using trimmed = await builtWith("trimmed", form);
      expect(trimmed.build.stderr).toEndWith(`error: ${name} ${isLeftOut}\n`);
      expect(trimmed.build.exitCode).toBe(1);
      expect(await Bun.file(join(trimmed.folder, isWindows ? "program.exe" : "program")).exists()).toBe(false);
    });

    test.each(inThisPart(formsByKeeping))("%s is obeyed where compile.trim keeps that part: %s, %s", async (name, form, keep) => {
      using whole = await builtWith("whole", form);
      expect(whole.build).toMatchObject({ exitCode: 0 });
      const folder = laidOut(join(root, String(folders++)), "trimmed");
      await builtKeeping(folder, keep, [form]);
      expect(await started(folder, name)).toEqual(await started(whole.folder, name));
      rmSync(folder, { recursive: true, force: true });
    });

    test.each(inThisPart(formsOf(loadCode)))("%s is refused when the executable starts: %s", async (name, form) => {
      using trimmed = await builtWith("trimmed", form);
      expect(trimmed.build).toMatchObject({ exitCode: 0 });
      expect(await started(trimmed.folder, name)).toEqual({ stdout: "", stderr: `error: ${name} ${loadsCode}\n`, exitCode: 1 });
    });
  });
}
