// How much of a program the ahead-of-time compiler knows: what `bun check --aot` says of it with --aot-explain, in one line. Nothing is compiled.
//
//   layouts   the kinds of objects that the program makes with a fixed layout
//   given     the types that data from outside the program is looked at as: a place of such a type holds anything
//   open      the types through which objects without a layout may be seen too: every read through one tests for them
//   places    of the parameters, results, joins and fields of typed code: how many have a type that says something
//   reads     of what typed code reads from properties and elements: how many have one
//
// A change to the compiler that turns a fact into a prediction, or takes a layout away, changes no answer of any program. It shows here.
import { bunEnv, bunExe } from "harness";
import { dirname } from "path";
import { spawned } from "../run-programs";

export type Typedness = { line: string; types: string[] };

/** `types`: the ten named types that most properties are read through, each closed or open, and the declared types that are given. */
export async function typednessOf(entryPoint: string): Promise<Typedness> {
  const checked = await spawned([bunExe(), "check", "--aot", "--aot-explain=given", "--aot-explain=mutations", "--aot-explain=foreign", entryPoint], dirname(entryPoint), bunEnv);
  const said = checked.stdout + checked.stderr;
  const facts = /^aot: given: facts: (\d+) of (\d+) \([^)]*\) of the places, (\d+) of (\d+) /m.exec(said);
  if (checked.signal) return { line: `signal ${checked.signal}`, types: [] };
  if (!facts) return { line: "is refused", types: [] };
  const layouts = /^aot: given: layouts that objects are made as: (\d+)$/m.exec(said)?.[1];
  const given = /; (\d+) types are given$/m.exec(said)?.[1];
  const open = said.match(/^aot: foreign: /gm)?.length ?? 0;
  return {
    line: `${layouts} layouts, ${given} given, ${open} open, places ${facts[1]} of ${facts[2]}, reads ${facts[3]} of ${facts[4]}`,
    types: [
      ...[...said.matchAll(/^aot: given: read through: (.*): (\d+) reads: (closed|open)$/gm)].map(([, name, reads, state]) => `${name}: ${state}, ${reads} reads`),
      ...[...said.matchAll(/^aot: mutations: given: where: by what it is: (.*)$/gm)].map(([, name]) => `${name}: given`),
    ],
  };
}
