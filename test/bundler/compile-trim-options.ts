// The options that a compiled executable reads from BUN_OPTIONS and from --compile-exec-argv, sorted by what becomes of each in an executable built with --aot, and with --trim.
import { bunEnv, bunExe } from "harness";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { inTurn as slot } from "../aot/harness/shared-builds";

export const source = readFileSync(join(import.meta.dir, "../../src/runtime/cli/Arguments.rs"), "utf8");

export function specsIn(table: string): string[] {
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

export const themselves = (names: string) => Object.fromEntries(names.split(" ").map(name => [name, [name]]));

export const obeyed: Record<string, string[]> = {
  ...themselves(
    "--silent --version -v --revision --bun -b --no-orphans --workspaces --parallel --sequential --no-exit-on-error",
  ),
  ...themselves("--no-clear-screen --smol --aot-huge-heap --interactive"),
  ...themselves(
    "--if-present --no-install --prefer-offline --prefer-latest --experimental-http2-fetch --experimental-http3-fetch",
  ),
  ...themselves(
    "--insecure-http-parser --experimental-stream-iter --expose-gc --no-deprecation --throw-deprecation --no-warnings",
  ),
  ...themselves(
    "--trace-warnings --trace-deprecation --pending-deprecation --zero-fill-buffers --use-system-ca --use-openssl-ca --use-bundled-ca",
  ),
  // Native code carries out the first, and nobody does anything for the second.
  "--stack-trace-limit": ["--stack-trace-limit=3", "--stack-trace-limit 3"],
  ...themselves("--trace-env-native-stack"),
  ...themselves(
    "--tls-min-v1.0 --tls-min-v1.1 --tls-min-v1.2 --tls-min-v1.3 --tls-max-v1.2 --tls-max-v1.3 --no-addons --no-ffi-cc",
  ),
  ...themselves(
    "--preserve-symlinks --preserve-symlinks-main --no-macros --jsx-side-effects --ignore-dce-annotations --no-env-file",
  ),
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
  "--cpu-prof-interval": [
    "--cpu-prof-interval=100",
    "--cpu-prof --cpu-prof-dir=profiles --cpu-prof-name=c.cpuprofile --cpu-prof-interval=500",
  ],
  "--heap-prof": ["--heap-prof --heap-prof-dir=profiles --heap-prof-name=d.heapprofile"],
  "--heap-prof-md": ["--heap-prof-md --heap-prof-dir=profiles --heap-prof-name=e.md"],
  "--heap-prof-name": ["--heap-prof-name=x"],
  "--heap-prof-dir": ["--heap-prof-dir=profiles"],
  "--heap-prof-interval": [
    "--heap-prof-interval=100",
    "--heap-prof --heap-prof-dir=profiles --heap-prof-name=f.heapprofile --heap-prof-interval=1024",
  ],
  "--port": ["--port=4000"],
  "--origin": ["--origin=http://localhost"],
  "-u": ["-u=http://localhost"],
  "--conditions": ["--conditions=x"],
  "--max-http-header-size": ["--max-http-header-size=100", "--max-http-header-size=nonsense"],
  "--dns-result-order": [
    "--dns-result-order=ipv4first",
    "--dns-result-order=ipv6first",
    "--dns-result-order=verbatim",
    "--dns-result-order=nonsense",
  ],
  "--redirect-warnings": ["--redirect-warnings=warnings.txt"],
  "--disable-warning": ["--disable-warning=x"],
  "--title": ["--title=x", "--title x", "--title 'two words'"],
  "--disallow-code-generation-from-strings": [
    "--disallow-code-generation-from-strings",
    "--disallow-code-generation-from-strings=strict",
    "--disallow-code-generation-from-strings=nonsense",
  ],
  "--unhandled-rejections": [
    "--unhandled-rejections=strict",
    "--unhandled-rejections=none",
    "--unhandled-rejections=nonsense",
  ],
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

export const neverEnd = ["--watch", "--hot", "--redis-preconnect"];

export const needRemovedFeatures: Record<string, string[]> = themselves("--sql-preconnect");
export const needTheBunCommandLine: Record<string, string[]> = themselves(
  "--help -h --check --aot --aot-log-type-mismatches --debug-aot --expose-internals",
);
export const cantBeUsed = "can't be used with this executable";
export const wasLeftOut = /isn't in this executable|was not compiled into this executable/;
export const featureWasRemoved = `${cantBeUsed} because --trim removed the feature it needs`;
export const hasNoCommandLine = `${cantBeUsed} because it doesn't include the Bun command line. Run bun instead`;
export const runsOnlyCompiledCode = `${cantBeUsed} because it only runs code that was compiled into it. Rebuild it with --compile-inspector to load other code`;
export const hasNoFunctionSource = `${cantBeUsed} because it was built with --no-compile-function-source, so it only runs code that was compiled into it. Rebuild without that flag`;

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
  "--fetch-preconnect": {
    forms: ["--fetch-preconnect=http://127.0.0.1:9", "--fetch-preconnect http://127.0.0.1:9"],
    program: "calls-fetch.ts",
  },
  "--redis-preconnect": { forms: ["--redis-preconnect"], program: "constructs-a-redis-client.ts" },
};
export const obeyedWhereTheFeatureIsAllowed: Record<string, { forms: string[]; allow: Bun.Build.TrimFeature }> = {
  "-i": { forms: ["-i"], allow: "install" },
  "--install": {
    forms: ["--install=auto", "--install=force", "--install=fallback", "--install=nonsense"],
    allow: "install",
  },
};
export const nameTheExecutable: Record<string, string[]> = themselves("--aot-build-id");

export const longNames: Record<string, string> = { "-r": "--preload", "-e": "--eval", "-p": "--print", "-h": "--help" };

export const files = {
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

export const packageChosenAtRandom = /^( +(?:x|add|remove|update|info|why|create) +)\S+ +/gm;

export type Side = "whole" | "trimmed";
export const flagsOf = { whole: [], trimmed: ["--trim"] };

export function laidOut(root: string, side: Side) {
  const folder = join(root, side);
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), contents);
  }
  return folder;
}

export async function spawned(
  cmd: string[],
  folder: string,
  env: Record<string, string | undefined>,
  timeout: number,
  afterItsFirstWords?: number,
) {
  await using child = Bun.spawn({
    cmd,
    cwd: folder,
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout,
    killSignal: "SIGKILL",
  });
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
  const said = (text: string) =>
    text
      .replaceAll(folder, "<folder>")
      .replaceAll("program.exe", "program")
      .replace(packageChosenAtRandom, "$1<package> ");
  return { stdout: said(stdout), stderr: said(stderr), exitCode: child.signalCode ?? exitCode };
}

export const builtInThisTurn = (folder: string, side: Side, flags: string[] = [], program = "hello.ts") =>
  spawned(
    [bunExe(), "build", "--compile", "--aot", ...flagsOf[side], ...flags, program, "--outfile", "program"],
    folder,
    bunEnv,
    90_000,
  );
export const built = (...build: Parameters<typeof builtInThisTurn>) => slot(() => builtInThisTurn(...build));

export const builtAllowing = (folder: string, allow: Bun.Build.TrimFeature, execArgv: string[] = []) =>
  slot(() =>
    Bun.build({
      entrypoints: [join(folder, "hello.ts")],
      compile: { outfile: join(folder, "program"), aot: true, trim: { allow: [allow] }, execArgv },
    }),
  );

export const eachLineOnce = (text: string) => [...new Set(text.split("\n"))].join("\n");

export const printsTheIdOf = (build: { stdout: string }) => ({
  stdout: /^ +build id +([0-9a-f]{32})$/m.exec(build.stdout)?.[1] + "\n",
  stderr: "",
  exitCode: 0,
});

/** In its turn, as a build: one test asks for more than a hundred starts at once, and builds are started beside them. */
export async function started(folder: string, name: string, options?: string, args: string[] = []) {
  const cmd = [join(folder, "program"), ...args];
  const env = { ...bunEnv, BUN_OPTIONS: options };
  if (!neverEnd.includes(name)) return await slot(() => spawned(cmd, folder, env, 60_000));
  // Not a time from its start: the first start of a new executable on a busy Mac has taken more than five seconds.
  const killed = await slot(() => spawned(cmd, folder, env, 60_000, 2_000));
  return { ...killed, stdout: eachLineOnce(killed.stdout), stderr: eachLineOnce(killed.stderr) };
}

export const formsOf = (sorted: Record<string, string[]>) =>
  Object.entries(sorted).flatMap(([name, forms]) => forms.map(form => [name, form] as const));
export const formsByUse = Object.entries(obeyedWhereTheProgramUsesTheFeature).flatMap(([name, { forms, program }]) =>
  forms.map(form => [name, form, program] as const),
);
export const formsByAllowing = Object.entries(obeyedWhereTheFeatureIsAllowed).flatMap(([name, { forms, allow }]) =>
  forms.map(form => [name, form, allow] as const),
);
