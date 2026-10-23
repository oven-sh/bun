// `array.sort(comparator)` and `array.toSorted(comparator)` run in the compiler's own library, src/aot/prelude/array-sort.ts: one
// set of functions for every array and every comparator of a program. Compiled once, each of them handles the elements of every
// call in the program and calls the comparator by value, so a second call of sort somewhere else makes the first one slower.
//
// A direct call that passes one known function for a parameter that the callee calls goes to a copy of the callee made for that
// function. The copy passes the comparator on, so the functions below it get copies too. In a copy the comparator is a known
// function, and the inliner takes it in.
//
// The program has five calls with five comparators: one more than a call by value tests for, so without the copies nothing
// about a comparator is known where it is called.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { compileCommand, isDeveloperFlag, runtimeEnvironment, withoutPass } from "./harness/flags";
import { describe, printIR, test, writesProgramInto } from "./harness/printed-ir";
import { isDeclared } from "./harness/registry";
import { built, slot, spawned, told, withoutCoreDump } from "./run-programs";

const program = join(import.meta.dir, "programs", "arrays", "sort-sites-do-not-slow-each-other.ts");
const numberOfComparators = 5;

const libraryFunctions = readFileSync(
  join(import.meta.dir, "..", "..", "src", "aot", "prelude", "array-sort.ts"),
  "utf8",
)
  .split(/^(?=(?:export )?function \w)/m)
  .map(text => ({ name: /^(?:export )?function (\w+)/.exec(text)?.[1] ?? "", text }));
const namesWhere = (holds: (text: string) => boolean) =>
  new Set(libraryFunctions.filter(({ name, text }) => name !== "" && holds(text)).map(({ name }) => name));
const takesComparator = namesWhere(text => /^[^{]*\bcomparator: unknown,?\s*\)/.test(text));
// The searches in long runs are rare, so the library asks for a call there.
const asksForCalls = namesWhere(text => text.includes("$callNoInline<"));

type Frequency = "Normal" | "Unlikely" | "Rare";
const allBlocks: Frequency[] = ["Normal", "Unlikely", "Rare"];
const blocksThatAreNotRare: Frequency[] = ["Normal", "Unlikely"];
const normalBlocks: Frequency[] = ["Normal"];

type Block = { frequency: Frequency; operations: string[] };
type Body = {
  id: string;
  name: string;
  module: string;
  role: string;
  isModuleBody: boolean;
  /** The copy for arguments of other types than the declared ones. Typed code enters it only where a test has failed. */
  hasErasedTypes: boolean;
  /** Of a copy made for one function: that function. */
  madeFor: string | undefined;
  blocks: Block[];
};

const callsByValue = ["Call", "CallResolved", "CallMethod", "CallList", "CallForwardVarargs"];
const elementReads = ["GetDoubleIndex", "GetContiguousIndex"];

// `v12: number = Sub v3, v4 form=Numbers @120`, `LoopHint @88`
const opcodeOf = (operation: string) => /^(?:v\d+\b.*? = )?(\w+)/.exec(operation)?.[1] ?? "";
const isCallByValue = (operation: string) => callsByValue.includes(opcodeOf(operation));
const directCalleeOf = (operation: string) =>
  opcodeOf(operation) === "CallDirect" ? / function=(f\d+)\b/.exec(operation)?.[1] : undefined;
const operationsOf = (body: Body, frequencies: Frequency[]) =>
  body.blocks.filter(block => frequencies.includes(block.frequency)).flatMap(block => block.operations);

/** Every function after instruction selection. */
function parseBodies(dump: string) {
  const bodies = new Map<string, Body>();
  let body: Body | undefined;
  for (const line of dump.split(/\r?\n/)) {
    const head = /^function (f\d+)(?: name="([^"]*)")?(?: module=(m\d+))?.* \{$/.exec(line);
    if (head) {
      const role = / role=(\w+)/.exec(line)?.[1] ?? "Source";
      const callee = / derivation=\{[^}]*\bnode=(\d+)/.exec(line)?.[1];
      body = {
        id: head[1],
        name: head[2] ?? "",
        module: head[3] ?? "",
        role,
        isModuleBody: / kind=Module\b/.test(line),
        hasErasedTypes: /\bHasErasedTypes\b/.test(line),
        madeFor: role === "CalleeVersion" && callee !== undefined ? "f" + callee : undefined,
        blocks: [],
      };
      bodies.set(body.id, body);
    } else if (line === "}") body = undefined;
    else if (body && /^  b\d+\(/.test(line))
      body.blocks.push({
        frequency: (/ frequency=(Unlikely|Rare)\b/.exec(line)?.[1] ?? "Normal") as Frequency,
        operations: [],
      });
    else if (body && line.startsWith("    ")) body.blocks.at(-1)!.operations.push(line.trim());
  }
  return bodies;
}

/** The library's sort as the program's own code reaches it through direct calls, leaving out what only runs once a test has failed. */
function findSortsOf(dump: string) {
  const bodies = parseBodies(dump);
  const moduleBody = [...bodies.values()].find(body => body.isModuleBody && body.role === "Source");
  expect(moduleBody).toBeDefined();
  const isOfProgram = (body: Body) => body.module === moduleBody!.module;
  const calleeOf = (operation: string) => bodies.get(directCalleeOf(operation) ?? "");

  const reached = [...bodies.values()].filter(body => isOfProgram(body) && !body.hasErasedTypes);
  const seen = new Set(reached);
  for (const body of reached) {
    for (const operation of operationsOf(body, blocksThatAreNotRare)) {
      const callee = calleeOf(operation);
      if (!callee || callee.hasErasedTypes || seen.has(callee)) continue;
      seen.add(callee);
      reached.push(callee);
    }
  }

  const sorts = reached.filter(body => !isOfProgram(body) && takesComparator.has(body.name));
  return {
    copies: sorts.filter(body => body.madeFor !== undefined),
    shared: sorts.filter(body => body.role === "Library"),
    calleeOf,
    isOfProgram,
  };
}

const isInsertionSort = (body: Body) => body.name === "insertionSortDoubles" || body.name === "insertionSortValues";
const namesOf = (bodies: Body[]) => [...new Set(bodies.map(body => body.name))].sort();

function find(bodies: Body[], frequencies: Frequency[], matches: (operation: string, body: Body) => boolean) {
  return bodies.flatMap(body =>
    operationsOf(body, frequencies)
      .filter(operation => matches(operation, body))
      .map(operation => `${body.name} ${body.id}${body.madeFor ? ` for ${body.madeFor}` : ""}: ${operation}`),
  );
}

async function compile(folder: string, name: string, flags: string[]) {
  const executable = join(folder, name + (isWindows ? ".exe" : ""));
  const command = [bunExe(), ...compileCommand, "--explain=statistics", ...flags, writesProgramInto(folder), program];
  const build = await spawned([...command, "--outfile", executable], dirname(program), { ...bunEnv, NO_COLOR: "1" });
  built(build);
  const code = await printIR(folder, { until: "Select", flags: flags.filter(isDeveloperFlag) });
  const lines = build.stderr.matchAll(/^(\w+) (\d+)$/gm);
  const statistics = new Map(Array.from(lines, ([, statistic, value]) => [statistic, Number(value)] as const));
  return { executable, statistics, sorts: findSortsOf(code) };
}

describe.concurrent("compile/aot/sort comparators", () => {
  test("the library's text and the operations are what this file looks for", () => {
    expect([...takesComparator]).toEqual(
      expect.arrayContaining(["sort", "toSorted", "insertionSortDoubles", "insertionSortValues", "gallopLeft"]),
    );
    expect([...asksForCalls].sort()).toEqual(["gallopLeft", "gallopRight"]);
    expect(
      ["CallDirect", ...callsByValue, ...elementReads].filter(operation => !isDeclared("operations", operation)),
    ).toEqual([]);
    expect(isDeclared("statistics", "CalleeVersions")).toBe(true);
  });

  // TODO: the build makes no version of the sort for a comparator.
  test.todo(
    "each call has its own copy of the sort, with its comparator inside",
    () =>
      slot(async () => {
        using dir = tempDir("aot-sort-comparators", {});
        const { executable, statistics, sorts } = await compile(String(dir), "copies", []);
        const { copies, shared, calleeOf, isOfProgram } = sorts;

        expect(statistics.get("CalleeVersions")).toBeGreaterThanOrEqual(numberOfComparators);
        expect(namesOf(shared)).toEqual([]);

        const comparators = [...new Set(copies.map(copy => copy.madeFor))];
        expect(comparators.length).toBe(numberOfComparators);
        for (const comparator of comparators) {
          const own = copies.filter(copy => copy.madeFor === comparator);
          expect({
            comparator,
            readsElements: find(own, normalBlocks, operation => elementReads.includes(opcodeOf(operation))).length > 0,
          }).toEqual({ comparator, readsElements: true });
        }
        expect(
          find(
            copies,
            blocksThatAreNotRare,
            (operation, copy) => (calleeOf(operation)?.madeFor ?? copy.madeFor) !== copy.madeFor,
          ),
        ).toEqual([]);

        expect(find(copies, normalBlocks, isCallByValue)).toEqual([]);
        expect(find(copies.filter(isInsertionSort), allBlocks, isCallByValue)).toEqual([]);

        const callsProgram = (operation: string) => {
          const callee = calleeOf(operation);
          return callee !== undefined && isOfProgram(callee);
        };
        expect(
          find(
            copies.filter(copy => !asksForCalls.has(copy.name)),
            blocksThatAreNotRare,
            callsProgram,
          ),
        ).toEqual([]);

        const plain = await spawned([bunExe(), "run", program], dirname(program), bunEnv);
        expect({ signal: plain.signal, exitCode: plain.exitCode }).toEqual({ signal: null, exitCode: 0 });
        const compiled = await spawned(withoutCoreDump([executable]), dirname(program), {
          ...bunEnv,
          [runtimeEnvironment.forbidsInterpreter]: "1",
        });
        expect({ signal: compiled.signal, ...told(compiled) }).toEqual({ signal: null, ...told(plain) });
      }),
    600_000,
  );

  test(
    "without the pass that makes the copies all calls share one sort, which calls by value",
    () =>
      slot(async () => {
        using dir = tempDir("aot-sort-comparators-shared", {});
        const { statistics, sorts } = await compile(String(dir), "shared", [withoutPass("InlineCalls")]);
        expect(statistics.get("CalleeVersions") ?? 0).toBe(0);
        expect(sorts.copies).toEqual([]);
        expect(namesOf(sorts.shared)).toEqual(
          expect.arrayContaining(["insertionSortDoubles", "insertionSortValues", "sort", "toSorted"]),
        );
        for (const name of ["insertionSortDoubles", "insertionSortValues"]) {
          const bodies = sorts.shared.filter(body => body.name === name);
          expect({ name, callsByValue: find(bodies, normalBlocks, isCallByValue).length > 0 }).toEqual({
            name,
            callsByValue: true,
          });
        }
      }),
    600_000,
  );
});
