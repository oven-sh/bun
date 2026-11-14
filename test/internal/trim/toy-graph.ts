import type { EntryPoint } from "../../../scripts/build/trim/entry-points.ts";
import type { Feature, FeatureModel } from "../../../scripts/build/trim/features.ts";
import { createSectionGraph, findEdge, type SectionGraph } from "../../../scripts/build/trim/graph.ts";
import { partition, smallestGroupBytes, type Partition } from "../../../scripts/build/trim/partition.ts";

export const feature = (name: string, index: number, more: Partial<Feature> = {}): Feature => ({
  name,
  rustName: name,
  index,
  text: name,
  enteredFrom: "program",
  isEngine: index < 128,
  minimumBytes: {},
  exports: false,
  ...more,
});

export const modelOf = (...features: Feature[]): FeatureModel => ({
  features,
  trimFeatures: [],
  icuData: [],
  icuLanguageGroups: [],
  hash: 0n,
});

export const [A, B, C, Startup, Tools] = [0, 1, 2, 3, 128];
export const abc: FeatureModel = modelOf(
  feature("A", A),
  feature("B", B),
  feature("C", C),
  feature("Startup", Startup, { enteredFrom: "startup" }),
  feature("Tools", Tools, { enteredFrom: "command-line" }),
);
export const abcWith = (index: number, more: Partial<Feature>): FeatureModel =>
  modelOf(...abc.features.map(original => (original.index === index ? { ...original, ...more } : original)));

export interface Section {
  size?: number;
  to?: string[];
  root?: true;
  exported?: true;
  live?: true;
  output?: string;
  foldedWith?: string[];
}

export const tableOutput = ".data.rel.ro";

export function graphOf(sections: Record<string, Section>): { graph: SectionGraph; node(name: string): number } {
  const names = Object.keys(sections);
  const details = Object.values(sections);
  const nodeOfName = new Map(names.map((name, index) => [name, index]));
  const node = (name: string): number => {
    const index = nodeOfName.get(name);
    if (index === undefined) throw new Error(`no section is named ${name}`);
    return index;
  };
  const nodesWith = (flag: "root" | "exported" | "live"): Set<number> =>
    new Set(names.filter(name => sections[name]![flag]).map(node));

  const size = details.map(section => section.size ?? 2 * smallestGroupBytes);
  let nextAddress = 0x200000;
  const address = size.map(bytes => {
    const start = nextAddress;
    nextAddress += bytes;
    return start;
  });

  const aliases = new Map<number, [string, string][]>();
  details.forEach(({ foldedWith }, index) => {
    if (foldedWith === undefined) return;
    aliases.set(
      index,
      foldedWith.map((other): [string, string] => ["other.o", other]),
    );
  });

  const graph = createSectionGraph({
    format: "elf",
    isArm64: false,
    placedCount: names.length,
    address,
    size,
    alignment: names.map(() => 16),
    output: details.map(section => section.output ?? ".text"),
    object: names.map(() => "toy.o"),
    section: names.map(name => ".text." + name),
    successors: details.map(section => new Set((section.to ?? []).map(node))),
    roots: nodesWith("root"),
    exported: nodesWith("exported"),
    liveWithoutReference: nodesWith("live"),
    names: names.map(name => [name]),
    aliases,
    externalNames: new Set(),
    stringHash: new Map(),
  });
  return { graph, node };
}

export type Guard = [
  guard: string,
  entry: string,
  feature: number,
  more?: Partial<Pick<EntryPoint, "stub" | "origin" | "builtin" | "entrySection">>,
];

export type Partitioned = Partition & {
  graph: SectionGraph;
  model: FeatureModel;
  entryPoints: EntryPoint[];
  node(name: string): number;
  features(name: string): number[];
  exactFeatures(name: string): number[];
  retained(): string[];
};

export function partitioned(sections: Record<string, Section>, guards: Guard[], model: FeatureModel = abc): Partitioned {
  const { graph, node } = graphOf(sections);
  const entryPoints = guards.map(
    ([guard, entry, guardedFeature, more]): EntryPoint => ({
      guard: node(guard),
      entry: node(entry),
      feature: guardedFeature,
      stub: more?.stub ?? (more?.builtin === undefined ? "Abort" : "Throw"),
      origin: more?.origin ?? (more?.builtin === undefined ? "NativeCode" : "Builtin"),
      builtin: more?.builtin,
      entrySection: more?.entrySection ?? "toy.o\0" + entry,
    }),
  );
  const result = partition({
    graph,
    entryPoints,
    model,
    isMovable: output => output === ".text" || output === ".rodata",
    isCode: output => output === ".text",
  });
  return {
    ...result,
    graph,
    model,
    entryPoints,
    node,
    features: name => result.sets[result.setOf[node(name)]!]!,
    exactFeatures: name => result.sets[result.exactSetOf[node(name)]!]!,
    retained: () => Object.keys(sections).filter(name => result.isRetained[node(name)] === 1),
  };
}

export const edgeKindOf = (result: Partitioned, from: string, to: string): number | undefined =>
  result.edgeKind[findEdge(result.graph, result.node(from), result.node(to))];
