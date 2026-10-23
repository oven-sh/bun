// What the compiler says of a function's parameters and result, held against what plain Bun shows. No optimization has to read the
// summaries for this test to fail: it asks the compiler itself.
//
// generate-relations-at-random.ts --who-keeps writes random programs that end by calling each of their helpers 300 times with fresh
// objects and closures that nobody else holds. Run by plain Bun, each prints which parameters (and which objects that a parameter
// holds) are still alive a turn and two collections later, by WeakRef, and what each helper answered. The same program is handed to the
// front end, and `testaot`'s command `relational-summary` prints what the link of the summaries says of every function, `fates-at-calls`
// what it says of each operand of each call: of a helper's one call at the end of the program, with the closures that this caller passes.
//   kept in truth             the summary, and the answer at the call, must show a fate that keeps: stored in a variable, an environment
//                             or an unknown object, handed to unknown code, yielded, anything; or stored into another parameter (operand)
//                             of which that holds
//   answered in truth         where the summary lists the origins of the result in full, the answer must be among them, and a result
//                             that is said to be fresh is a new object every time
// The other direction is no error: a summary may say less than is true of one run.
//
// One thing that plain Bun shows is not the language's: all closures made in one scope share one environment, so a variable that one
// closure captures stays alive as long as ANY closure of that scope does, or any closure made inside one. Such a parameter is not judged.
//
// Needs `testaot`: shell/tools.ts says where it is looked for.
//   AOT_WHO_KEEPS_SEEDS=400 AOT_WHO_KEEPS_FIRST=7000 bun test test/aot/relations-who-keeps.test.ts    other programs, or more of them
import { expect, test } from "bun:test";
import { readdirSync, writeFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { availableParallelism } from "os";
import { join } from "path";
import { unsupported } from "./run-programs";
import { testaot, toolEnv } from "./shell/tools";

const whySkipped = unsupported
  ? unsupported
  : !testaot
    ? "there is no testaot: not in $TESTAOT, not beside the Bun under test, not in build/release-local or build/release"
    : undefined;
if (whySkipped) console.error(`SKIPPED: test/aot/relations-who-keeps.test.ts: ${whySkipped}`);

const numberOfSeeds = Number(process.env.AOT_WHO_KEEPS_SEEDS ?? 24);
const firstSeed = Number(process.env.AOT_WHO_KEEPS_FIRST ?? 1);

async function run(cmd: string[], cwd: string, env: Record<string, string | undefined>) {
  await using tool = Bun.spawn({ cmd, cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([tool.stdout.text(), tool.stderr.text(), tool.exited]);
  return { stdout, stderr, exitCode };
}

const fatesThatKeep = [
  "stored-in-variable",
  "stored-in-environment",
  "stored-in-unknown-object",
  "handed-to-unknown-code",
  "yielded",
  "anything",
  "incomplete",
];
const operationsThatMake = ["NewObject", "NewArray", "NewClosure", "NewDictionary", "Data", "NewRegExp"];

interface Summary {
  parameters: Map<number, string>;
  result?: string;
}

/** The entry parameters that plain Bun may keep alive through a closure that does not capture them. */
function findParametersInSharedEnvironment(body: string, bodies: Map<string, string>) {
  const sameAs = new Map<string, string>();
  for (const [, result, operand] of body.matchAll(/^ +(v\d+) = (?:Convert|Check|CheckInitialized) (v\d+)\b/gm))
    sameAs.set(result, sameAs.get(operand) ?? operand);
  const closures = [...body.matchAll(/ = NewClosure ([^=\n]*?) ?function=(f\d+)/g)].map(([, operands, callee]) => ({
    captured: operands
      .split(",")
      .map(operand => operand.trim())
      .filter(Boolean)
      .map(operand => sameAs.get(operand) ?? operand),
    makesClosures: bodies.get(callee)?.includes(" = NewClosure ") ?? true,
  }));
  const shared = new Set<number>();
  for (const closure of closures) {
    for (const value of closure.captured) {
      if (closure.makesClosures || closures.some(other => !other.captured.includes(value)))
        shared.add(Number(value.slice(1)));
    }
  }
  return shared;
}

/** The helpers by name: the function's number in the IR text, and how many entry parameters stand in front of its own. */
function findHelpers(text: string) {
  const bodies = new Map(
    [...text.matchAll(/^function (f\d+) .*\n((?:  .*\n)*)\}/gm)].map(match => [match[1], match[2]]),
  );
  const helpers = new Map<string, { id: string; offset: number; inSharedEnvironment: Set<number> }>();
  for (const match of text.matchAll(/^function (f\d+) name="(h\d+)" (.*)$/gm)) {
    const head = match[3].split(" relations=")[0];
    const flags = / flags=\[([^\]]*)\]/.exec(" " + head)?.[1] ?? "";
    const captures = / captures=\[(.*?)\] /.exec(" " + head)?.[1] ?? "";
    const offset =
      captures.split("{type=").length -
      1 +
      ["HasThis", "TakesCallee", "HasNewTarget", "HasArgumentCount"].filter(flag => flags.includes(flag)).length;
    if (!helpers.has(match[2]))
      helpers.set(match[2], {
        id: match[1],
        offset,
        inSharedEnvironment: findParametersInSharedEnvironment(bodies.get(match[1]) ?? "", bodies),
      });
  }
  return helpers;
}

function readSummaries(output: string) {
  const summaries = new Map<string, Summary>();
  let current: Summary | undefined;
  for (const line of output.split("\n")) {
    if (/^f\d+$/.test(line)) summaries.set(line, (current = { parameters: new Map() }));
    const parameter = /^  p(\d+): (.*)$/.exec(line);
    if (parameter) current?.parameters.set(Number(parameter[1]), parameter[2]);
    const result = /^  result0: (.*)$/.exec(line);
    if (result && current) current.result = result[1];
  }
  return summaries;
}

function mayKeep(summary: Summary, parameter: number, withContents: boolean, seen: number[] = []): boolean {
  const text = summary.parameters.get(parameter);
  if (text === undefined) return true;
  const asked = withContents ? text : text.split(" | contents:")[0];
  if (fatesThatKeep.some(fate => asked.includes(fate))) return true;
  const mask = Number(/stored-into-parameters=(\d+)/.exec(text)?.[1] ?? 0);
  for (let other = 0; other < 32; other++) {
    if (
      (mask >>> other) & 1 &&
      other !== parameter &&
      !seen.includes(other) &&
      mayKeep(summary, other, true, [...seen, parameter])
    )
      return true;
  }
  return false;
}

/** What `fates-at-calls` says of the operands of the one call of each helper in ask(). The caller drops what is returned and what is thrown. */
function readFatesAtCallsOfHelpers(text: string, output: string) {
  const ask = /^function (f\d+) name="ask" .*\n((?:  .*\n)*)\}/m.exec(text);
  if (!ask) return undefined;
  // The numbers of the values in the text are not those of the program as read: the calls are matched by their order.
  const written = [...ask[2].matchAll(/^ +(?:v\d+ = )?Call .*$/gm)].map(
    ([line]) => / calleeName="(\w+)"/.exec(line)?.[1] ?? "",
  );
  const answered = new Map<string, Map<number, string>>();
  for (const [, id, operand, fate] of output.matchAll(
    new RegExp(`^${ask[1]} (v\\d+) Call operand (\\d+): (.*)$`, "gm"),
  )) {
    if (!answered.has(id)) answered.set(id, new Map());
    answered.get(id)!.set(Number(operand), fate);
  }
  if (answered.size !== written.length) return undefined;
  return new Map(
    [...answered.values()]
      .map((operands, index) => [written[index], operands] as const)
      .filter(([name]) => /^h\d+$/.test(name)),
  );
}

function mayKeepAtCall(
  operands: Map<number, string>,
  operand: number,
  withContents: boolean,
  seen: number[] = [],
): boolean {
  const text = operands.get(operand);
  if (text === undefined) return true;
  const [itself, rest] = text.split(" contents=");
  const contents = rest === undefined ? "anything" : rest.split(" ")[0];
  if (fatesThatKeep.some(fate => itself.includes(fate) || (withContents && contents.includes(fate)))) return true;
  const into = / stored-into-operands(?:-or-deeper)?=\[([^\]]*)\]/.exec(text)?.[1];
  const others = into === undefined ? [] : into === "any" ? [...operands.keys()] : into.split(",").map(Number);
  return others.some(
    other =>
      other !== operand &&
      !seen.includes(other) &&
      operands.has(other) &&
      mayKeepAtCall(operands, other, true, [...seen, operand]),
  );
}

function isAmongOrigins(result: string, answer: string, offset: number): boolean {
  const head = /^(fresh )?one of \[([^\]]*)\]/.exec(result);
  if (!head) return true;
  if (head[1]) return answer === "a new object";
  const named = new Map([...result.matchAll(/\| (o\d+) = ([^|]*)/g)].map(match => [match[1], match[2].trim()]));
  const origins = head[2].split(",").map(name => named.get(name.trim()) ?? "?");
  const makes = (origin: string) => operationsThatMake.includes(origin.split(" ")[0]);
  if (
    !origins.every(
      origin =>
        origin.startsWith("parameter ") || origin.startsWith("Null") || /^[Uu]ndefined/.test(origin) || makes(origin),
    )
  )
    return true;
  if (answer.startsWith("parameter ")) return origins.includes("parameter " + (offset + Number(answer.split(" ")[1])));
  if (answer === "null") return origins.some(origin => origin.startsWith("Null"));
  return answer === "a new object" && origins.some(makes);
}

async function ask(folder: string, name: string) {
  const contradictions: string[] = [];
  let kept = 0;
  let answers = 0;
  let saidToBeKeptNowhere = 0;
  const plain = await run([bunExe(), "run", name], folder, bunEnv);
  expect({ name, stderr: plain.stderr, exitCode: plain.exitCode }).toEqual({ name, stderr: "", exitCode: 0 });
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", `--aot-out=${name}.wire`, name, "--outfile", name + ".exe"],
    folder,
    bunEnv,
  );
  expect({ name, stderr: built.stderr, exitCode: built.exitCode }).toEqual({
    name,
    stderr: expect.not.stringMatching(/^error\b/m),
    exitCode: 0,
  });
  const printed = await run([testaot!, "print", name + ".wire"], folder, toolEnv);
  expect({ name, stderr: printed.stderr, exitCode: printed.exitCode }).toEqual({ name, stderr: "", exitCode: 0 });
  writeFileSync(
    join(folder, name + ".ir"),
    "# LIBRARY: own\n# RUN: relational-summary\n# CHECK: p0:\n# RUN(CALLS): fates-at-calls\n# CALLS: operand 0:\n" +
      printed.stdout,
  );
  const linked = await run([testaot!, "run", name + ".ir", "--show-output"], folder, toolEnv);
  // Whether the run counts as passed depends on which limits a whole library happens to hit. What it prints is what is judged.
  const atCalls = readFatesAtCallsOfHelpers(printed.stdout, linked.stdout);
  expect({ name, printsSummaries: /^ +p0:/m.test(linked.stdout), printsFatesAtCalls: atCalls !== undefined }).toEqual({
    name,
    printsSummaries: true,
    printsFatesAtCalls: true,
  });

  const helpers = findHelpers(printed.stdout);
  const summaries = readSummaries(linked.stdout);
  for (const [, helper, parameter, count] of plain.stdout.matchAll(/^KEPT (h\d+) parameter (\d+): (\d+)$/gm)) {
    const { id, offset, inSharedEnvironment } = helpers.get(helper)!;
    const summary = summaries.get(id);
    const isHeld = Number(parameter) >= 100;
    const index = offset + (Number(parameter) % 100);
    // The collector scans the stack conservatively: what the last calls were handed may be alive by chance.
    if (!summary || inSharedEnvironment.has(index) || Number(count) < 3) continue;
    kept++;
    if (!mayKeep(summary, index, isHeld))
      contradictions.push(
        `${name} ${helper}: ${isHeld ? "what is held by " : ""}p${index} is alive (${count} of 300), and the summary keeps it nowhere: ${summary.parameters.get(index)}`,
      );
    const operands = atCalls!.get(helper);
    const operand = 2 + (Number(parameter) % 100);
    if (operands && !mayKeepAtCall(operands, operand, isHeld))
      contradictions.push(
        `${name} ${helper}: ${isHeld ? "what is held by " : ""}operand ${operand} of its call is alive (${count} of 300), and at the call it is kept nowhere: ${operands.get(operand)}`,
      );
  }
  for (const [, helper, answer, count] of plain.stdout.matchAll(/^ANSWERED (h\d+) (.*): (\d+)$/gm)) {
    const { id, offset } = helpers.get(helper)!;
    const result = summaries.get(id)?.result;
    if (result === undefined) continue;
    answers++;
    if (!isAmongOrigins(result, answer, offset))
      contradictions.push(
        `${name} ${helper}: answered ${answer} (${count} of 300), which is not among the origins: ${result}`,
      );
  }
  for (const { id, offset } of helpers.values()) {
    const summary = summaries.get(id);
    for (const parameter of summary?.parameters.keys() ?? [])
      if (parameter >= offset && !mayKeep(summary!, parameter, false)) saidToBeKeptNowhere++;
  }
  let saidToBeKeptNowhereAtCalls = 0;
  for (const operands of atCalls!.values())
    for (const operand of operands.keys())
      if (operand >= 2 && !mayKeepAtCall(operands, operand, false)) saidToBeKeptNowhereAtCalls++;
  return { contradictions, kept, answers, saidToBeKeptNowhere, saidToBeKeptNowhereAtCalls };
}

test.skipIf(!!whySkipped)(
  "what the summaries say of the helpers of random programs is what plain Bun shows",
  async () => {
    using temporary = tempDir("aot-who-keeps", {
      "tsconfig.json": JSON.stringify({ extends: join(import.meta.dir, "programs", "tsconfig.json") }),
    });
    const folder = String(temporary);
    const generated = await run(
      [
        bunExe(),
        join(import.meta.dir, "generate-relations-at-random.ts"),
        "--who-keeps",
        "--first",
        String(firstSeed),
        "--seeds",
        String(numberOfSeeds),
        "--folder",
        folder,
      ],
      folder,
      bunEnv,
    );
    expect({ stderr: generated.stderr, exitCode: generated.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const names = readdirSync(folder).filter(name => /^seed-\d+\.[jt]s$/.test(name));
    expect(names.length).toBe(numberOfSeeds);

    const total = {
      contradictions: [] as string[],
      kept: 0,
      answers: 0,
      saidToBeKeptNowhere: 0,
      saidToBeKeptNowhereAtCalls: 0,
    };
    const worker = async () => {
      for (let name = names.pop(); name !== undefined; name = names.pop()) {
        const one = await ask(folder, name);
        total.contradictions.push(...one.contradictions);
        total.kept += one.kept;
        total.answers += one.answers;
        total.saidToBeKeptNowhere += one.saidToBeKeptNowhere;
        total.saidToBeKeptNowhereAtCalls += one.saidToBeKeptNowhereAtCalls;
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, availableParallelism()) }, worker));
    expect(total.contradictions.sort()).toEqual([]);
    // A run in which nothing is kept, or a compiler that says "anything" of everything, would pass as well and show nothing.
    expect(total.kept).toBeGreaterThan(numberOfSeeds * 2);
    expect(total.answers).toBeGreaterThan(numberOfSeeds * 2);
    expect(total.saidToBeKeptNowhere).toBeGreaterThan(numberOfSeeds * 2);
    expect(total.saidToBeKeptNowhereAtCalls).toBeGreaterThan(numberOfSeeds * 2);
  },
  20 * 60_000,
);
