// Each file of the program makes a Worker from text and prints what the Worker reports.
import { expect } from "bun:test";
import { bunEnv, bunExe, isBuildKite, isIntelMacOS, tempDirWithBunTypes } from "harness";
import { chmodSync, copyFileSync, existsSync, linkSync, rmSync, statSync, writeFileSync } from "node:fs";
import { availableParallelism, loadavg, totalmem } from "node:os";
import { join } from "node:path";
import { featureNamed, model } from "../bundler/compile-trim-features";
import { without } from "./harness/capabilities";
import { run } from "./harness/run";
import { sharedBuilds, type Build } from "./harness/shared-builds";
import { withoutDebugInformation } from "./harness/without-debug-information";
import { test as oneAtATime } from "./supported";
import { readRemovedFeatures } from "./trimmed-against-whole/removed-features";

const text = `postMessage("ran")`;
const listen = (name: string) => `
worker.onmessage = event => {
  console.log(${JSON.stringify(name)}, "message", event.data);
  worker.terminate();
};
worker.onerror = event => console.log(${JSON.stringify(name)}, "error", event.message.replace(/blob:[-0-9a-f]+/, "blob:"));
`;

const files = {
  "program.js": `import "./data-url.js";\nimport "./blob-url.js";\nimport "./evaluated.js";\n`,
  "data-url.js": `const worker = new Worker("data:application/javascript," + encodeURIComponent(${JSON.stringify(text)}));${listen("a data: URL")}`,
  "blob-url.js": `const worker = new Worker(URL.createObjectURL(new Blob([${JSON.stringify(text)}], { type: "application/javascript" })));${listen("a blob: URL")}`,
  "evaluated.js": `import { Worker } from "node:worker_threads";
const worker = new Worker("require('node:worker_threads').parentPort.postMessage('ran')", { eval: true });
worker.on("message", message => {
  console.log("eval: true of node:worker_threads", "message", message);
  worker.terminate();
});
worker.on("error", error => console.log("eval: true of node:worker_threads", "error", error.message.replace(/blob:[-0-9a-f]+/, "blob:")));
`,
};

const made = `Buffer.from(${JSON.stringify(text)}).toString()`;
const filesWithTextMadeAtRunTime = {
  "made-at-run-time.js": `import "./made-blob-url.js";\nimport "./made-evaluated.js";\n`,
  "made-blob-url.js": `const worker = new Worker(URL.createObjectURL(new Blob([${made}], { type: "application/javascript" })));${listen("a blob: URL")}`,
  "made-evaluated.js": `import { Worker } from "node:worker_threads";
const worker = new Worker(Buffer.from("require('node:worker_threads').parentPort.postMessage('ran')").toString(), { eval: true });
worker.on("message", message => {
  console.log("eval: true of node:worker_threads", "message", message);
  worker.terminate();
});
worker.on("error", error => console.log("eval: true of node:worker_threads", "error", error.message.replace(/blob:[-0-9a-f]+/, "blob:")));
`,
};

// One build of each program writes the executable without --trim and the one with it, and serves every test. The tests run beside
// one another, so both programs are built at once and their four executables start at once.
const test = oneAtATime.skipIf(!!without("a Bun that trims")).concurrent;
const { folder, buildWholeAndTrimmed } = sharedBuilds("worker-of-text", { ...files, ...filesWithTextMadeAtRunTime });
const wholeAndTrimmed = (entry: string) => buildWholeAndTrimmed(entry, "--explain=trim");

// Temporary, for the probe at the end of the file: when each step of the tests began and ended, in milliseconds.
const fileBegan = performance.now();
const marks: string[] = [];
const mark = (what: string) => void marks.push(`${Math.round(performance.now() - fileBegan)} ${what}`);

/** What both executables of a program print. Its Workers report in any order, so the lines are sorted. */
async function reportedBy(entry: string) {
  mark(`${entry}: asks for its build`);
  const [whole, trimmed] = await wholeAndTrimmed(entry);
  mark(`${entry}: built`);
  const reported = async ({ name, executable }: Build) => {
    const { stdout, stderr, exitCode } = await run([executable], folder);
    mark(`${name}: ended`);
    return { lines: stdout.split("\n").sort(), stderr, exitCode };
  };
  const [byWhole, byTrimmed] = await Promise.all([reported(whole), reported(trimmed)]);
  return { whole: byWhole, trimmed: byTrimmed };
}

/** Each Worker sent its message and none failed. The empty line is what follows the last line break. */
const everyWorkerRan = (...lines: string[]) => ({ lines: ["", ...lines], stderr: "", exitCode: 0 });

function removedFrom(built: Build) {
  const indexes = readRemovedFeatures(built.file);
  expect(indexes).toBeDefined();
  return model.features.filter(feature => indexes!.includes(feature.index)).map(feature => feature.name);
}

test("a trimmed executable reports the same for a Worker made from text as one that is not trimmed", async () => {
  const ran = everyWorkerRan(
    "a blob: URL message ran",
    "a data: URL message ran",
    "eval: true of node:worker_threads message ran",
  );
  expect(await reportedBy("program.js")).toEqual({ whole: ran, trimmed: ran });
});

test("a trimmed executable runs a Worker made from text that the build has not seen", async () => {
  const ran = everyWorkerRan("a blob: URL message ran", "eval: true of node:worker_threads message ran");
  expect(await reportedBy("made-at-run-time.js")).toEqual({ whole: ran, trimmed: ran });
});

test("a program that starts a Worker from text keeps the transpiler, and the build says why", async () => {
  const report = async (entry: string) => {
    const [whole, trimmed] = await wholeAndTrimmed(entry);
    const [, saidOfTheTranspiler] =
      /^aot: trim: (kept|removed) Bun\.Transpiler and the transpiler for code loaded at run time\b/m.exec(
        trimmed.stderr,
      ) ?? [];
    const removed = removedFrom(trimmed);
    return {
      saidOfTheTranspiler,
      saysWhy:
        /^aot: trim: blocked by dynamic-import: the program starts a Worker from code that isn't in the executable\b/m.test(
          trimmed.stderr,
        ),
      // What the executables themselves record: --trim took features out, and the transpiler is none of them.
      lacksTheTranspiler: removed.includes(featureNamed("RuntimeTranspiler")),
      lacksMoreThanTheWholeOne: removed.length > removedFrom(whole).length,
    };
  };
  const keepsItAndSaysWhy = {
    saidOfTheTranspiler: "kept",
    saysWhy: true,
    lacksTheTranspiler: false,
    lacksMoreThanTheWholeOne: true,
  };
  expect(await report("made-at-run-time.js")).toEqual(keepsItAndSaysWhy);
  expect(await report("program.js")).toEqual(keepsItAndSaysWhy);
});

// Temporary, and gone with the next commit. Where does the time of this file go on the macOS x64 lane of CI? There the first try
// of the file measures and fails, so that the log of the job shows the lines that begin with PROBE, and the second try passes.
const probes = (isIntelMacOS && isBuildKite) || !!process.env.WORKER_OF_TEXT_PROBE;
// The first try leaves this file and the second removes it. An older one is of a job that never came to its second try.
const triedBefore = join("/tmp", "worker-of-text-probe-tried");
const hasTriedBefore = () => existsSync(triedBefore) && Date.now() - statSync(triedBefore).mtimeMs < 30 * 60_000;

const probe = oneAtATime.skipIf(!!without("a Bun that trims") || !probes);
probe(
  "temporary probe: where the time goes on this lane",
  async () => {
    if (hasTriedBefore()) return void rmSync(triedBefore);
    writeFileSync(triedBefore, "");
    await Promise.all([wholeAndTrimmed("program.js"), wholeAndTrimmed("made-at-run-time.js")]);
    const say = (what: string, found: unknown) => console.error(`PROBE ${what}: ${JSON.stringify(found)}`);
    say("the tests above, milliseconds from the start of the file", marks);

    using dir = tempDirWithBunTypes("worker-of-text-probe", {
      ...files,
      ...filesWithTextMadeAtRunTime,
      "hello.js": `console.log("hello");\n`,
      "script.sh": `#!/bin/sh\necho hello\n`,
    });
    const at = (name: string) => join(String(dir), name);
    const since = (began: number) => Math.round(performance.now() - began);

    /** `ms`: until it had ended. `first`: until it had printed anything. `cpu`: processor time of the process. */
    const timed = async (cmd: string[], env: Record<string, string | undefined> = bunEnv) => {
      const began = performance.now();
      await using proc = Bun.spawn({ cmd, cwd: String(dir), env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
      let first = -1;
      let lines = 0;
      const read = (async () => {
        for await (const chunk of proc.stdout) {
          if (first < 0) first = since(began);
          for (const byte of chunk) if (byte === 10) lines++;
        }
      })();
      const [stderr, exit] = await Promise.all([proc.stderr.text(), proc.exited, read]);
      const cpu = Math.round(Number(proc.resourceUsage()?.cpuTime.total ?? 0n) / 1000);
      return { ms: since(began), first, cpu, exit, lines, stderrBytes: stderr.length };
    };
    const said = async (cmd: string[], keeps = (line: string) => line !== "") => {
      try {
        await using proc = Bun.spawn({ cmd, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
        const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        return (stdout + stderr)
          .split("\n")
          .map(line => line.trim().replace(/\s+/g, " "))
          .filter(keeps)
          .slice(0, 20)
          .join(" | ")
          .slice(0, 900);
      } catch (error) {
        return String(error).slice(0, 120);
      }
    };
    // The processor time that the system's own watchers of new files and executables have used so far.
    const checkers = () =>
      said(["/bin/ps", "-axo", "cputime=,comm="], line =>
        /[/ ](syspolicyd|XprotectService|XProtectPluginService|amfid|trustd|oahd|endpointsecurityd|taskgated|tccd|mds|mds_stores|fseventsd|kernel_task)$/.test(
          line,
        ),
      );
    const build = (entry: string, outfile: string, flags: string[], env = bunEnv) =>
      timed([bunExe(), "build", "--compile", ...flags, ...withoutDebugInformation, entry, "--outfile", outfile], env);
    const trimmedWithReport = ["--aot", "--trim", "--explain=trim"];
    const programs = [
      ["program.js", "p"],
      ["made-at-run-time.js", "m"],
    ] as const;

    say("the machine", {
      processors: availableParallelism(),
      gigabytes: Math.round(totalmem() / 2 ** 30),
      load: loadavg(),
      bun: [bunExe().split("/").slice(-2).join("/"), statSync(bunExe()).size],
      model: await said(["sysctl", "-n", "hw.model", "machdep.cpu.brand_string", "sysctl.proc_translated"]),
      gatekeeper: await said(["spctl", "--status"]),
      integrity: await said(["csrutil", "status"]),
      developerTools: await said(["DevToolsSecurity", "-status"]),
    });
    say("processor time of the checkers, at the start", await checkers());

    // What the file did before this change: the two builds of a program at once, then its executables one after another.
    const asBefore = async (round: number) => {
      const began = performance.now();
      for (const [entry, short] of programs) {
        const name = `old${round}-${short}`;
        const builds = performance.now();
        const [whole, trimmed] = await Promise.all([
          build(entry, `${name}-whole`, ["--aot"]),
          build(entry, `${name}-trimmed`, trimmedWithReport),
        ]);
        say(`as before, round ${round}, ${entry}: two builds at once`, { ms: since(builds), whole, trimmed });
        for (const which of short === "p" ? ["whole", "trimmed"] : ["whole", "trimmed", "whole"])
          say(`as before, round ${round}, ${entry}: start of ${which}`, await timed([at(`${name}-${which}`)]));
      }
      say(`as before, round ${round}, all of it`, { ms: since(began), load: loadavg() });
    };
    // What the file does now: the programs at once, one build for both executables of each, which start at once.
    const asNow = async (round: number) => {
      const began = performance.now();
      await Promise.all(
        programs.map(async ([entry, short]) => {
          const name = `new${round}-${short}`;
          const both = await build(entry, `${name}-trimmed`, trimmedWithReport, {
            ...bunEnv,
            BUN_DEBUG_TEST_UNTRIMMED_OUTFILE: at(`${name}-whole`),
          });
          const built = since(began);
          const starts = await Promise.all([timed([at(`${name}-whole`)]), timed([at(`${name}-trimmed`)])]);
          say(`as now, round ${round}, ${entry}`, { built, build: both, ended: since(began), starts });
        }),
      );
      say(`as now, round ${round}, all of it`, { ms: since(began), load: loadavg() });
    };
    for (const round of [1, 2]) {
      await asBefore(round);
      await asNow(round);
    }
    say("processor time of the checkers, behind the rounds", await checkers());

    const four = ["old1-p-whole", "old1-p-trimmed", "old1-m-whole", "old1-m-trimmed"];
    say(
      "bytes of the four executables",
      four.map(name => statSync(at(name)).size),
    );
    say("signature of an executable", await said(["codesign", "-dv", at("old1-p-whole")]));
    for (const name of four) say(`a second start of ${name}`, await timed([at(name)]));

    const copies = four.map((name, index) => {
      copyFileSync(at(name), at(`copy-${index}`));
      chmodSync(at(`copy-${index}`), 0o755);
      return at(`copy-${index}`);
    });
    const atOnce = performance.now();
    const each = await Promise.all(copies.map(copy => timed([copy])));
    say("first starts of copies of the four, at once", { ms: since(atOnce), each });

    // Is it the path, the file or what the file holds that is new? And does a signature change it?
    linkSync(at("old1-p-whole"), at("link"));
    say("first start of a second name of a file that has started", await timed([at("link")]));
    copyFileSync(at("old1-p-whole"), at("signed"));
    chmodSync(at("signed"), 0o755);
    say(
      "codesign --force --sign - of a copy",
      await timed(["codesign", "--force", "--sign", "-", at("signed")]).catch(String),
    );
    say("first start of the signed copy", await timed([at("signed")]));
    say("second start of the signed copy", await timed([at("signed")]));

    for (const [name, flags] of [
      ["hello-aot", ["--aot"]],
      ["hello-plain", []],
    ] as const) {
      say(`hello.js, ${name}: build`, await build("hello.js", name, [...flags]));
      say(`hello.js, ${name}: first start`, await timed([at(name)]));
      say(`hello.js, ${name}: second start`, await timed([at(name)]));
    }
    chmodSync(at("script.sh"), 0o755);
    say("a shell script: first start", await timed([at("script.sh")]));
    say("a shell script: second start", await timed([at("script.sh")]));
    say("bun --version", await timed([bunExe(), "--version"]));
    say("processor time of the checkers, at the end", await checkers());
    say("at the end", { ms: since(fileBegan), load: loadavg() });
    throw new Error("temporary probe: the numbers are in the lines above that begin with PROBE. The next try passes");
  },
  600_000,
);
