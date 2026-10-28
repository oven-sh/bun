import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithBunTypes as tempDir } from "harness";
import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { slot, unsupported } from "../aot/run-programs";
import { canTrim } from "./compile-trim-features";

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
  ...themselves("--no-clear-screen --smol --aot-huge-heap --interactive"),
  ...themselves("--if-present --no-install --prefer-offline --prefer-latest --experimental-http2-fetch --experimental-http3-fetch"),
  ...themselves("--insecure-http-parser --experimental-stream-iter --expose-gc --no-deprecation --throw-deprecation --no-warnings"),
  ...themselves("--trace-warnings --trace-deprecation --pending-deprecation --zero-fill-buffers --use-system-ca --use-openssl-ca --use-bundled-ca"),
  // Native code carries out the first, and nobody does anything for the second.
  "--stack-trace-limit": ["--stack-trace-limit=3", "--stack-trace-limit 3"],
  ...themselves("--trace-env-native-stack"),
  ...themselves("--tls-min-v1.0 --tls-min-v1.1 --tls-min-v1.2 --tls-min-v1.3 --tls-max-v1.2 --tls-max-v1.3 --no-addons --no-ffi-cc"),
  ...themselves("--preserve-symlinks --preserve-symlinks-main --no-macros --jsx-side-effects --ignore-dce-annotations --no-env-file"),
  "--elide-lines": ["--elide-lines=3"],
  "--filter": ["--filter=x"],
  "-F": ["-F=x", "-F x"],
  "--shell": ["--shell=bun", "--shell=system"],
  "--watch-kill-signal": ["--watch-kill-signal=SIGTERM"],
  "--aot-graph-fd": ["--aot-graph-fd=9"],
  "--aot-checked": ["--aot-checked=-"],
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

export const needRemovedFeatures: Record<string, string[]> = themselves("--sql-preconnect");
export const needTheBunCommandLine: Record<string, string[]> = themselves("--help -h --check --aot --aot-log-type-mismatches --debug-aot --expose-internals");
const cantBeUsed = "can't be used with this executable";
const wasLeftOut = /isn't in this executable|was not compiled into this executable/;
const featureWasRemoved = `${cantBeUsed} because --trim removed the feature it needs`;
const hasNoCommandLine = `${cantBeUsed} because it doesn't include the Bun command line. Run bun instead`;
const runsOnlyCompiledCode = `${cantBeUsed} because it only runs code that was compiled into it. Rebuild it with --compile-inspector to load other code`;
const hasNoFunctionSource = `${cantBeUsed} because it was built with --no-compile-function-source, so it only runs code that was compiled into it. Rebuild without that flag`;

// A module of the library carries these out, and the image has the modules that the program uses. They print or write something for whoever started the program, which does the same without them.
export const ignoredWithAWarning: Record<string, string[]> = {
  ...themselves("--trace-env --trace-env-js-stack --trace-exit --trace-events-enabled"),
  "--trace-event-categories": ["--trace-event-categories=node", "--trace-event-categories node"],
  "--trace-event-file-pattern": ["--trace-event-file-pattern=trace.log"],
};
export const loadCode: Record<string, string[]> = {
  ...themselves("--watch --hot"),
  "--preload": ["--preload=./preloaded.ts", "--preload ./preloaded.ts"],
  "-r": ["-r=./preloaded.ts", "-r ./preloaded.ts"],
  "--require": ["--require=./preloaded.ts"],
  "--import": ["--import=./preloaded.ts"],
  "--eval": ["--eval=1"],
  "-e": ["-e=1", "-e 1"],
  "--print": ["--print=1"],
  "-p": ["-p=1", "-p 1"],
};
export const obeyedWhereTheProgramUsesTheFeature: Record<string, { forms: string[]; program: string }> = {
  "--fetch-preconnect": { forms: ["--fetch-preconnect=http://127.0.0.1:9", "--fetch-preconnect http://127.0.0.1:9"], program: "calls-fetch.ts" },
  "--redis-preconnect": { forms: ["--redis-preconnect"], program: "constructs-a-redis-client.ts" },
};
export const obeyedWhereTheFeatureIsAllowed: Record<string, { forms: string[]; allow: Bun.Build.TrimFeature }> = {
  "-i": { forms: ["-i"], allow: "install" },
  "--install": { forms: ["--install=auto", "--install=force", "--install=fallback", "--install=nonsense"], allow: "install" },
};
export const nameTheExecutable: Record<string, string[]> = themselves("--aot-build-id");

const longNames: Record<string, string> = { "-r": "--preload", "-e": "--eval", "-p": "--print", "-h": "--help" };

const files = {
  "hello.ts": `console.log("hello world");`,
  "calls-fetch.ts": `console.log("hello world", typeof fetch);\nif (process.argv.length > 9) await fetch(process.argv[9]);`,
  "constructs-a-redis-client.ts": `console.log("hello world", typeof Bun.RedisClient);\nif (process.argv.length > 9) new Bun.RedisClient(process.argv[9]);`,
  "tsconfig.json": `{ "compilerOptions": { "types": ["bun"] } }`,
  "preloaded.ts": `console.log("preloaded");`,
  "other.env": "FROM_A_FILE=1\n",
  "own.toml": "[console]\ndepth = 1\n",
  "tsconfig.other.json": "{}",
  "sub/keep": "",
};

const packageChosenAtRandom = /^( +(?:x|add|remove|update|info|why|create) +)\S+ +/gm;

type Side = "whole" | "trimmed";
const flagsOf = { whole: [], trimmed: ["--trim"] };

function laidOut(root: string, side: Side) {
  const folder = join(root, side);
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), contents);
  }
  return folder;
}

async function spawned(cmd: string[], folder: string, env: Record<string, string | undefined>, timeout: number, afterItsFirstWords?: number) {
  await using child = Bun.spawn({ cmd, cwd: folder, env, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout, killSignal: "SIGKILL" });
  let end: ReturnType<typeof setTimeout> | undefined;
  const textOf = async (stream: ReadableStream<Uint8Array>) => {
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
      if (afterItsFirstWords !== undefined) end ??= setTimeout(() => child.kill("SIGKILL"), afterItsFirstWords);
    }
    return Buffer.concat(chunks).toString();
  };
  const [stdout, stderr, exitCode] = await Promise.all([textOf(child.stdout), textOf(child.stderr), child.exited]);
  clearTimeout(end);
  const said = (text: string) => text.replaceAll(folder, "<folder>").replaceAll("program.exe", "program").replace(packageChosenAtRandom, "$1<package> ");
  return { stdout: said(stdout), stderr: said(stderr), exitCode: child.signalCode ?? exitCode };
}

const builtInThisTurn = (folder: string, side: Side, flags: string[] = [], program = "hello.ts") =>
  spawned([bunExe(), "build", "--compile", "--aot", ...flagsOf[side], ...flags, program, "--outfile", "program"], folder, bunEnv, 90_000);
const built = (...build: Parameters<typeof builtInThisTurn>) => slot(() => builtInThisTurn(...build));

const builtAllowing = (folder: string, allow: Bun.Build.TrimFeature, execArgv: string[] = []) =>
  slot(() => Bun.build({ entrypoints: [join(folder, "hello.ts")], compile: { outfile: join(folder, "program"), aot: true, trim: { allow: [allow] }, execArgv } }));

const eachLineOnce = (text: string) => [...new Set(text.split("\n"))].join("\n");

const printsTheIdOf = (build: { stdout: string }) => ({ stdout: /^ +build id +([0-9a-f]{32})$/m.exec(build.stdout)?.[1] + "\n", stderr: "", exitCode: 0 });

async function started(folder: string, name: string, options?: string, args: string[] = []) {
  const cmd = [join(folder, "program"), ...args];
  if (!neverEnd.includes(name)) return await spawned(cmd, folder, { ...bunEnv, BUN_OPTIONS: options }, 60_000);
  // Not a time from its start: the first start of a new executable on a busy Mac has taken more than five seconds.
  const killed = await spawned(cmd, folder, { ...bunEnv, BUN_OPTIONS: options }, 60_000, 2_000);
  return { ...killed, stdout: eachLineOnce(killed.stdout), stderr: eachLineOnce(killed.stderr) };
}

const formsOf = (sorted: Record<string, string[]>) => Object.entries(sorted).flatMap(([name, forms]) => forms.map(form => [name, form] as const));
const formsByUse = Object.entries(obeyedWhereTheProgramUsesTheFeature).flatMap(([name, { forms, program }]) => forms.map(form => [name, form, program] as const));
const formsByAllowing = Object.entries(obeyedWhereTheFeatureIsAllowed).flatMap(([name, { forms, allow }]) => forms.map(form => [name, form, allow] as const));

export function testTheSorting() {
  test("every option that a compiled executable reads is in one of the lists: it works like in the untrimmed executable, it is ignored with a warning, or it fails at startup", () => {
    const sorted = [obeyed, obeyedWhereTheProgramUsesTheFeature, obeyedWhereTheFeatureIsAllowed, nameTheExecutable, needRemovedFeatures, needTheBunCommandLine, ignoredWithAWarning, loadCode].flatMap(Object.keys).sort();
    expect(sorted).toEqual(namesInTheSource);
  });
}

export function testBunOptions() {
  if (!canTrim || unsupported) return test.skip("BUN_OPTIONS, in an executable built with --trim", () => {});

  describe.concurrent("BUN_OPTIONS, in an executable built with --trim", () => {
    const dir = tempDir("compile-trim-runtime-options", {});
    afterAll(() => dir[Symbol.dispose]());
    const root = realpathSync(String(dir));
    const whole = laidOut(root, "whole");
    const trimmed = laidOut(root, "trimmed");
    const withoutFunctionSource = { whole: laidOut(join(root, "without-function-source"), "whole"), trimmed: laidOut(join(root, "without-function-source"), "trimmed") };
    let folders = 0;
    let finished: Awaited<ReturnType<typeof built>>[] = [];

    beforeAll(async () => {
      const builds = [
        built(whole, "whole"),
        built(trimmed, "trimmed"),
        built(withoutFunctionSource.whole, "whole", ["--no-compile-function-source"]),
        built(withoutFunctionSource.trimmed, "trimmed", ["--no-compile-function-source"]),
      ];
      finished = await Promise.all(builds);
      expect(finished).toMatchObject(builds.map(() => ({ exitCode: 0 })));
    });

    test.each(formsOf(obeyed))("%s works like in the untrimmed executable: %s", async (name, form) => {
      expect(await started(trimmed, name, form)).toEqual(await started(whole, name, form));
    });

    test.each(formsOf(nameTheExecutable))("%s prints what the build of that executable printed, which isn't what the untrimmed one prints: %s", async (name, form) => {
      const printed = [await started(whole, name, form), await started(trimmed, name, form)];
      expect(printed).toEqual([printsTheIdOf(finished[0]), printsTheIdOf(finished[1])]);
      expect(printed[1].stdout).not.toBe(printed[0].stdout);
    });

    test.each(formsOf(needRemovedFeatures))("%s fails at startup: %s", async (name, form) => {
      expect(await started(trimmed, name, form)).toEqual({ stdout: "", stderr: `error: ${longNames[name] ?? name} ${featureWasRemoved}\n`, exitCode: 1 });
    });

    test.each(formsOf(needTheBunCommandLine))("%s fails at startup, with and without --trim, because no executable built with --aot includes the Bun command line: %s", async (name, form) => {
      const failure = { stdout: "", stderr: `error: ${longNames[name] ?? name} ${hasNoCommandLine}\n`, exitCode: 1 };
      expect(await started(trimmed, name, form)).toEqual(failure);
      expect(await started(whole, name, form)).toEqual(failure);
    });

    test.each(formsOf(ignoredWithAWarning))("%s is ignored with a warning, with and without --trim, and the program runs: %s", async (name, form) => {
      const ran = (reason: string) => ({ stdout: "hello world\n", stderr: `warn: ${name} is ignored by this executable because ${reason}\n`, exitCode: 0 });
      const ofDefaultBuild = ran("it only runs code that was compiled into it. Rebuild it with --compile-inspector to load other code");
      expect(await started(trimmed, name, form)).toEqual(ofDefaultBuild);
      expect(await started(whole, name, form)).toEqual(ofDefaultBuild);
      const withoutSource = ran("it was built with --no-compile-function-source, so it only runs code that was compiled into it. Rebuild without that flag");
      expect(await started(withoutFunctionSource.trimmed, name, form)).toEqual(withoutSource);
      expect(await started(withoutFunctionSource.whole, name, form)).toEqual(withoutSource);
    });

    test.each(formsOf(loadCode))("%s fails at startup, with and without --trim, because the executable only runs code that was compiled into it: %s", async (name, form) => {
      const failure = { stdout: "", stderr: `error: ${longNames[name] ?? name} ${runsOnlyCompiledCode}\n`, exitCode: 1 };
      expect(await started(trimmed, name, form)).toEqual(failure);
      expect(await started(whole, name, form)).toEqual(failure);
    });

    test.each(formsOf(loadCode))("%s fails at startup in an executable built with --no-compile-function-source, with and without --trim: %s", async (name, form) => {
      const failure = { stdout: "", stderr: `error: ${longNames[name] ?? name} ${hasNoFunctionSource}\n`, exitCode: 1 };
      expect(await started(withoutFunctionSource.trimmed, name, form)).toEqual(failure);
      expect(await started(withoutFunctionSource.whole, name, form)).toEqual(failure);
    });

    test.each(formsByUse)("%s fails at startup where the program doesn't use the client that it connects: %s", async (name, form) => {
      expect(await started(trimmed, name, form)).toEqual({ stdout: "", stderr: `error: ${name} ${featureWasRemoved}\n`, exitCode: 1 });
    });

    test.each(formsByUse)("%s works where the program uses that client: %s, %s", async (name, form, program) => {
      const folder = join(root, String(folders++));
      const sides = [laidOut(folder, "whole"), laidOut(folder, "trimmed")];
      expect(await Promise.all([built(sides[0], "whole", [], program), built(sides[1], "trimmed", [], program)])).toMatchObject([{ exitCode: 0 }, { exitCode: 0 }]);
      expect(await started(sides[1], name, form)).toEqual(await started(sides[0], name, form));
    });

    test.each(formsByAllowing)("%s fails at startup, with and without --trim, because the feature that it needs is part of the Bun command line: %s", async (name, form) => {
      const failure = { stdout: "", stderr: `error: ${name} ${hasNoCommandLine}\n`, exitCode: 1 };
      expect(await started(trimmed, name, form)).toEqual(failure);
      expect(await started(whole, name, form)).toEqual(failure);
    });

    test.each(formsByAllowing)("%s is read where compile.trim.allow lists that feature: %s, %s", async (name, form, allow) => {
      const folder = laidOut(join(root, String(folders++)), "trimmed");
      await builtAllowing(folder, allow);
      const ran = await started(folder, name, form);
      if (form.endsWith("=nonsense")) expect(ran).toMatchObject({ stdout: "", stderr: expect.stringContaining(`error: Invalid value for ${name}: "nonsense".`), exitCode: 1 });
      else expect(ran).toEqual({ stdout: "hello world\n", stderr: "", exitCode: 0 });
    });

    test("as arguments of the executable they all belong to the program", async () => {
      const args = [...[obeyed, nameTheExecutable, needRemovedFeatures, needTheBunCommandLine, ignoredWithAWarning, loadCode].flatMap(formsOf), ...formsByUse, ...formsByAllowing].flatMap(([, form]) => form.split(" "));
      expect(await started(trimmed, "", undefined, args)).toEqual({ stdout: "hello world\n", stderr: "", exitCode: 0 });
    });
  });
}

export function testExecArgv(part: number, parts: number) {
  const inThisPart = <T>(forms: T[]) => forms.filter((_, index) => index % parts === part - 1);

  if (!canTrim || unsupported) return test.skip("--compile-exec-argv with --trim", () => {});

  describe.concurrent("--compile-exec-argv with --trim", () => {
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

    async function worksLikeInTheUntrimmedExecutable(name: string, form: string, program?: string) {
      const both = await builtBothWaysWith(form, program);
      using whole = both[0];
      using trimmed = both[1];
      expect([whole.build, trimmed.build]).toMatchObject([{ exitCode: 0 }, { exitCode: 0 }]);
      const ran = await started(whole.folder, name);
      expect(ran.stderr).not.toMatch(wasLeftOut);
      expect(await started(trimmed.folder, name)).toEqual(ran);
    }

    test.each(inThisPart(formsOf(obeyed)))("%s works like in the untrimmed executable: %s", (name, form) => worksLikeInTheUntrimmedExecutable(name, form));

    test.each(inThisPart(formsOf(nameTheExecutable)))("%s prints what the build of that executable printed: %s", async (name, form) => {
      const both = await builtBothWaysWith(form);
      using whole = both[0];
      using trimmed = both[1];
      expect([whole.build, trimmed.build]).toMatchObject([{ exitCode: 0 }, { exitCode: 0 }]);
      expect([await started(whole.folder, name), await started(trimmed.folder, name)]).toEqual([printsTheIdOf(whole.build), printsTheIdOf(trimmed.build)]);
    });

    test.each(inThisPart([needRemovedFeatures, needTheBunCommandLine].flatMap(formsOf)))("%s works, because the build keeps the feature that it needs: %s", (name, form) => worksLikeInTheUntrimmedExecutable(name, form));

    test.each(inThisPart(formsByUse))("%s works even if the program never uses the client, because the build keeps it: %s", (name, form) => worksLikeInTheUntrimmedExecutable(name, form));

    test.each(inThisPart(formsByUse))("%s works where the program uses that client: %s, %s", async (name, form, program) => {
      const both = await builtBothWaysWith(form, program);
      using whole = both[0];
      using trimmed = both[1];
      expect([whole.build, trimmed.build]).toMatchObject([{ exitCode: 0 }, { exitCode: 0 }]);
      expect(await started(trimmed.folder, name)).toEqual(await started(whole.folder, name));
    });

    test.each(inThisPart(formsByAllowing))("%s works, because the build keeps the feature that it needs: %s", (name, form) => worksLikeInTheUntrimmedExecutable(name, form));

    test.each(inThisPart(formsByAllowing))("%s works where compile.trim.allow lists that feature: %s, %s", async (name, form, allow) => {
      using whole = await builtWith("whole", form);
      expect(whole.build).toMatchObject({ exitCode: 0 });
      const folder = laidOut(join(root, String(folders++)), "trimmed");
      await builtAllowing(folder, allow, [form]);
      expect(await started(folder, name)).toEqual(await started(whole.folder, name));
      rmSync(folder, { recursive: true, force: true });
    });

    test.each(inThisPart([ignoredWithAWarning, loadCode].flatMap(formsOf)))("%s fails the build, with and without --trim, because the executable only runs code that was compiled into it: %s", async (name, form) => {
      const both = await builtBothWaysWith(form);
      using whole = both[0];
      using trimmed = both[1];
      const failure = { stderr: expect.stringContaining(`error: --aot does not support ${longNames[name] ?? name} in --compile-exec-argv because the executable only runs code that was compiled into it`), exitCode: 1 };
      expect([whole.build, trimmed.build]).toMatchObject([failure, failure]);
    });
  });
}
