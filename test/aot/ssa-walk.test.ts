// SSA repair against its own meaning. Random control flow (irreducible cycles, loops, handlers) with variables: a first definition in the entry, more anywhere, uses of every kind that all name
// the first. `testaot run --show-output` lets `# RUN: repair` mend each function, and every state that the printed function can reach is visited: a variable holds the definition that ran last,
// and each use has to name a value that holds it. The last test keeps one definition of each variable from the repair: the walk has to notice.
// A red function again: SSA_WALK_SEED=<seed> SSA_WALK_KEEP=<folder> bun test ssa-walk
import { expect } from "bun:test";
import { mkdirSync, writeFileSync } from "fs";
import { tempDir } from "harness";
import { join } from "path";
import { run, whySkipped } from "./engine-test-commands";
import { test } from "./harness/default-timeout";

type Parameter = { kind: "sees" | "defines"; variable: number };
type Made = {
  isHandler: boolean;
  successors: number[];
  slots: number;
  handler?: number;
  body: ["define" | "use" | "call", number][];
  parameter?: Parameter;
};
type Facts = {
  definitions: number[][];
  uses: Map<number, number>;
  sees: Map<number, number>;
  constants: boolean[];
  withheldReachesUse: boolean;
};
type Target = [block: number, args: number[]];
type Printed = {
  parameters: number[];
  values: { id: number; opcode: string; operands: number[]; rest: string }[];
  targets?: Target[];
  returned?: number;
  handler?: Target;
};

const shapes = {
  small: { blocks: [3, 9], variables: [1, 3], values: 4, handlers: 0.15, twins: 0 },
  wide: { blocks: [10, 40], variables: [2, 6], values: 4, handlers: 0.15, twins: 0.2 },
  deep: { blocks: [12, 40], variables: [1, 4], values: 3, handlers: 0.45, twins: 0.2 },
  twins: { blocks: [6, 24], variables: [3, 8], values: 5, handlers: 0.15, twins: 0.9 },
  large: { blocks: [120, 400], variables: [2, 6], values: 3, handlers: 0.1, twins: 0.3 },
};
type Shape = keyof typeof shapes;

function randomFrom(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const below = (n: number) => Math.floor(next() * n);
  return {
    next,
    below,
    between: (low: number, high: number) => low + below(high - low + 1),
    pick: <T>(list: T[]) => list[below(list.length)],
  };
}
type Random = ReturnType<typeof randomFrom>;

function make(random: Random, shape: Shape) {
  const { blocks: sizes, variables, values, handlers, twins } = shapes[shape];
  const count = random.between(sizes[0], sizes[1]);
  const numberOfVariables = random.between(variables[0], variables[1]);
  const constants = Array.from({ length: numberOfVariables }, () => random.next() < 0.15);
  const blocks: Made[] = Array.from({ length: count }, () => ({
    isHandler: false,
    successors: [],
    slots: 0,
    body: [],
  }));
  blocks[0].slots = random.pick([1, 2, 2]);
  const open: number[] = Array(blocks[0].slots).fill(0);
  for (let i = 1; i < count; i++) {
    const uncovered = Array.from({ length: i - 1 }, (_, j) => j + 1).filter(j => blocks[j].handler === undefined);
    if (uncovered.length && random.next() < handlers) {
      blocks[i].isHandler = true;
      for (let n = random.between(1, Math.min(4, uncovered.length)); n; n--)
        blocks[uncovered.splice(random.below(uncovered.length), 1)[0]].handler = i;
    } else {
      if (!open.length) {
        let j = random.below(i);
        while (blocks[j].slots >= 2) j = random.below(i);
        blocks[j].slots++;
        open.push(j);
      }
      blocks[open.splice(random.below(open.length), 1)[0]].successors.push(i);
    }
    blocks[i].slots = random.pick([0, 1, 1, 2, 2]);
    for (let n = blocks[i].slots; n; n--) open.push(i);
  }
  const targets = blocks.map((_, i) => i).filter(i => i && !blocks[i].isHandler);
  for (const j of open) if (targets.length) blocks[j].successors.push(random.pick(targets));
  for (let i = 1; i < count; i++) {
    const r = random.next();
    const variable = random.below(numberOfVariables);
    if (r < 0.12) blocks[i].parameter = { kind: "sees", variable };
    else if (r < 0.22 && !blocks[i].isHandler && !constants[variable])
      blocks[i].parameter = { kind: "defines", variable };
  }
  for (const block of blocks) {
    for (let n = random.between(0, values); n; n--) {
      const r = random.next();
      const variable = random.below(numberOfVariables);
      if (r < 0.3) {
        block.body.push(["define", variable]);
        if (random.next() < twins)
          for (let other = 0; other < numberOfVariables; other++)
            if (other !== variable && random.next() < 0.7) block.body.push(["define", other]);
      } else block.body.push([r < 0.7 ? "use" : "call", variable]);
    }
  }
  return { blocks, numberOfVariables, constants };
}

function write({ blocks, numberOfVariables, constants }: ReturnType<typeof make>, random: Random, withholds: boolean) {
  let next = 3;
  const lines: string[] = [];
  const definitions: number[][] = [];
  const uses = new Map<number, number>();
  const sees = new Map<number, number>();
  const returned = new Map<number, number>();
  const placeOf = new Map<number, [block: number, position: number]>();
  const define = (variable: number) =>
    constants[variable] ? `Integer integer=${7 + variable}` : `${random.pick(["Add", "Mul", "Sub"])} v1, v1`;
  for (let variable = 0; variable < numberOfVariables; variable++) {
    definitions.push([next]);
    lines.push(`    v${next++} = ${define(variable)}`);
  }
  const first = definitions.map(list => list[0]);
  const isReachedBackwards = new Set(blocks.flatMap((block, j) => block.successors.filter(s => s <= j)));
  const argumentFor = (target: number) => {
    const parameter = blocks[target].parameter;
    return !parameter ? "" : parameter.kind === "sees" ? `v${first[parameter.variable]}` : "v1";
  };
  blocks.forEach((block, i) => {
    if (i) {
      let head = "";
      if (block.parameter) {
        head = `v${next}: number`;
        if (block.parameter.kind === "sees") sees.set(next, block.parameter.variable);
        else definitions[block.parameter.variable].push(next);
        next++;
      }
      lines.push(
        `  b${i}(${head})${block.handler === undefined ? "" : ` handler=b${block.handler}(${argumentFor(block.handler)})`}${block.isHandler ? " role=CatchHandler" : ""}:`,
      );
      if (block.isHandler) lines.push(`    v${next++} = CatchValue`);
      if (isReachedBackwards.has(i)) {
        next++;
        lines.push("    LoopHint");
      }
    }
    block.body.forEach(([what, variable], position) => {
      if (what === "define") {
        definitions[variable].push(next);
        placeOf.set(next, [i, position]);
        lines.push(`    v${next} = ${define(variable)}`);
      } else if (what === "use") {
        uses.set(next, variable);
        lines.push(`    v${next} = Negate v${first[variable]}`);
      } else lines.push(`    v${next} = Call v0`);
      next++;
    });
    const [taken, notTaken] = block.successors;
    if (block.successors.length === 2)
      lines.push(
        `    Branch v2 -> taken b${taken}(${argumentFor(taken)}), notTaken b${notTaken}(${argumentFor(notTaken)})`,
      );
    else if (block.successors.length === 1) lines.push(`    Jump -> next b${taken}(${argumentFor(taken)})`);
    else {
      returned.set(i, random.below(numberOfVariables));
      lines.push(
        `    v${next++} = Integer integer=${markOfReturn + returned.get(i)!}`,
        `    Return v${first[returned.get(i)!]}`,
      );
    }
  });

  const reachesUse = (definition: number, variable: number) => {
    const place = placeOf.get(definition);
    if (!place || constants[variable]) return false;
    const seen = new Set<number>();
    const work: [number, number][] = [[place[0], place[1] + 1]];
    const isSeenBy = (target: number) =>
      blocks[target].parameter?.kind === "sees" && blocks[target].parameter!.variable === variable;
    while (work.length) {
      const [i, from] = work.pop()!;
      const block = blocks[i];
      let isDefinedAgain = false;
      for (const [what, other] of block.body.slice(from)) {
        if (what === "use" && other === variable) return true;
        if (what === "call" && block.handler !== undefined) {
          if (isSeenBy(block.handler)) return true;
          if (!seen.has(block.handler)) (seen.add(block.handler), work.push([block.handler, 0]));
        }
        if ((isDefinedAgain = what === "define" && other === variable)) break;
      }
      if (isDefinedAgain) continue;
      if (returned.get(i) === variable) return true;
      for (const target of block.successors) {
        if (isSeenBy(target)) return true;
        const parameter = blocks[target].parameter;
        if (parameter?.kind === "defines" && parameter.variable === variable) continue;
        if (!seen.has(target)) (seen.add(target), work.push([target, 0]));
      }
    }
    return false;
  };
  const told = definitions.map(list => (withholds && list.length > 1 ? list.slice(0, -1) : list));
  const words = told.filter(list => list.length > 1).map(list => "variable=" + list.map(v => `v${v}`).join(","));
  const text = [
    "# FORM: Prepared",
    `# RUN: repair function=f0 ${words.join(" ")}`,
    "",
    'module m0 path="main.js" displayPath="main.js"',
    'function f0 name="made" parameters=[{type=anything}, {type=number}, {type=boolean}] results=[{type=number}] {',
    ...lines,
    "}",
    "",
  ].join("\n");
  const withheldReachesUse =
    withholds && definitions.some((list, variable) => list.length > 1 && reachesUse(list.at(-1)!, variable));
  return { text, facts: { definitions, uses, sees, constants, withheldReachesUse } satisfies Facts };
}

// In front of each Return: the repair may cut the block, and the mark says which variable is returned.
const markOfReturn = 1000;

const idsIn = (text: string) => [...text.matchAll(/\bv(\d+)/g)].map(match => +match[1]);

function parse(output: string) {
  const blocks = new Map<number, Printed>();
  let current: Printed | undefined;
  for (const line of output.split("\n")) {
    const head = /^  b(\d+)\(([^)]*)\)(.*):$/.exec(line);
    if (head) {
      const handler = /handler=b(\d+)\(([^)]*)\)/.exec(head[3]);
      current = {
        parameters: idsIn(head[2]),
        values: [],
        handler: handler ? [+handler[1], idsIn(handler[2])] : undefined,
      };
      blocks.set(+head[1], current);
      continue;
    }
    if (!current) continue;
    const value = /^\s+v(\d+): [^=]+ = (\w+)(.*)$/.exec(line);
    if (value) current.values.push({ id: +value[1], opcode: value[2], operands: idsIn(value[3]), rest: value[3] });
    else if (/^\s+Return /.test(line)) current.returned = idsIn(line)[0];
    else if (/^\s+(Jump|Branch) /.test(line))
      current.targets = [...line.split("->")[1].matchAll(/b(\d+)\(([^)]*)\)/g)].map(match => [
        +match[1],
        idsIn(match[2]),
      ]);
  }
  return blocks;
}

// undefined: every state is right. "too many": there are more than `most`.
function explore(blocks: Map<number, Printed>, facts: Facts, most: number): string | undefined {
  const variableOf = new Map<number, number>();
  facts.definitions.forEach((list, variable) => list.forEach(v => variableOf.set(v, variable)));
  const parameters = new Set([...blocks.values()].flatMap(block => block.parameters));
  const constantOf = new Map<number, string>();
  for (const block of blocks.values())
    for (const value of block.values)
      if (value.opcode === "Integer") constantOf.set(value.id, `constant ${+/integer=(\d+)/.exec(value.rest)![1] - 7}`);
  type State = { at: number; passed?: string[]; holds: Map<number, string>; now: Map<number, string> };
  const seen = new Set<string>();
  const work: State[] = [{ at: 0, holds: new Map(), now: new Map() }];
  while (work.length) {
    const state = work.pop()!;
    const block = blocks.get(state.at)!;
    const holds = new Map(state.holds);
    const now = new Map(state.now);
    const held = (v: number) => (parameters.has(v) ? (holds.get(v) ?? "nothing") : (constantOf.get(v) ?? `v${v}`));
    const wanted = (variable: number) => (facts.constants[variable] ? `constant ${variable}` : now.get(variable));
    if (state.passed) {
      if (state.passed.length !== block.parameters.length)
        return `b${state.at} takes ${block.parameters.length} parameters and gets ${state.passed.length} arguments`;
      block.parameters.forEach((p, index) => holds.set(p, state.passed![index]));
      for (const p of block.parameters) {
        if (!variableOf.has(p)) continue;
        holds.set(p, `v${p}`);
        now.set(variableOf.get(p)!, `v${p}`);
      }
      for (const p of block.parameters) {
        const variable = facts.sees.get(p);
        if (variable !== undefined && holds.get(p) !== wanted(variable))
          return `the parameter v${p} of b${state.at} holds ${holds.get(p)}; variable ${variable} holds ${wanted(variable)}`;
      }
    }
    const key = `${state.at}|${[...now].sort((a, b) => a[0] - b[0])}|${[...holds].sort((a, b) => a[0] - b[0])}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (seen.size > most) return "too many";
    for (const value of block.values) {
      if (value.opcode === "Call" && block.handler)
        work.push({ at: block.handler[0], passed: block.handler[1].map(held), holds, now: new Map(now) });
      const variable = facts.uses.get(value.id);
      if (variable !== undefined && held(value.operands[0]) !== wanted(variable))
        return `the use v${value.id} in b${state.at} names v${value.operands[0]}, which holds ${held(value.operands[0])}; variable ${variable} holds ${wanted(variable)}`;
      if (variableOf.has(value.id)) now.set(variableOf.get(value.id)!, `v${value.id}`);
    }
    if (block.returned !== undefined) {
      const variable = +/integer=(\d+)/.exec(block.values.at(-1)!.rest)![1] - markOfReturn;
      if (held(block.returned) !== wanted(variable))
        return `b${state.at} returns v${block.returned}, which holds ${held(block.returned)}; variable ${variable} holds ${wanted(variable)}`;
    }
    for (const [to, args] of block.targets ?? []) work.push({ at: to, passed: args.map(held), holds, now });
  }
}

async function repairAndWalk(seed: number, shape: Shape, count: number, withholds: boolean) {
  using folder = tempDir("aot-ssa-walk", {});
  const kept = process.env.SSA_WALK_KEEP;
  const random = randomFrom(seed);
  const made = new Map<string, ReturnType<typeof write>>();
  for (let i = 0; i < count; i++) {
    const name = `s${seed}-${shape}-${i}.ir`;
    made.set(name, write(make(random, shape), random, withholds));
    writeFileSync(join(String(folder), name), made.get(name)!.text);
  }
  const { lines } = await run("run", String(folder), "--show-output");
  const outputs = new Map<string, string[]>();
  let current: string[] | undefined;
  for (const line of lines) {
    const head = /^OUTPUT .*?([^/\\]+\.ir):\d+:$/.exec(line);
    if (head) outputs.set(head[1], (current = []));
    else current?.push(line);
  }
  const result = { unanswered: [] as string[], faults: [] as string[], whole: 0, couldBeSeen: 0 };
  for (const [name, { text, facts }] of made) {
    const output = outputs.get(name)?.join("\n");
    if (!output?.includes("function f0")) {
      result.unanswered.push(name);
      continue;
    }
    result.couldBeSeen += +facts.withheldReachesUse;
    const fault = explore(parse(output), facts, 20_000);
    if (fault === undefined) result.whole++;
    else if (fault !== "too many") {
      result.faults.push(`${name}: ${fault}`);
      if (kept) {
        mkdirSync(kept, { recursive: true });
        writeFileSync(join(kept, name), text);
        writeFileSync(join(kept, name + ".out"), output);
      }
    }
  }
  return result;
}

const seed = +(process.env.SSA_WALK_SEED ?? 1);
const counts: Record<Shape, number> = { small: 150, wide: 40, deep: 40, twins: 60, large: 4 };

test.skipIf(!!whySkipped).each(Object.keys(counts) as Shape[])(
  "every use holds the definition that ran last: %s",
  async shape => {
    const { unanswered, faults, whole } = await repairAndWalk(seed, shape, counts[shape], false);
    expect({ unanswered, faults }).toEqual({ unanswered: [], faults: [] });
    if (shape !== "large") expect(whole).toBeGreaterThan(counts[shape] / 2);
  },
  120_000,
);

test.skipIf(!!whySkipped)(
  "the walk notices a definition that the repair was not told of",
  async () => {
    const { unanswered, faults, couldBeSeen } = await repairAndWalk(seed, "small", 100, true);
    expect(unanswered).toEqual([]);
    expect(couldBeSeen).toBeGreaterThan(30);
    expect(faults.length).toBeGreaterThanOrEqual(couldBeSeen * 0.9);
  },
  120_000,
);
