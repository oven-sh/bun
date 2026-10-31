// Differential check of the cascade layers in bundled CSS. A random `@import` graph of CSS files is evaluated the way
// a browser evaluates it (CSS Cascading 5) by the small model below, which was checked against Chrome. The same graph
// is bundled into one file with `bun build --minify`, and the model evaluates that file too.
//
// The first mention of a layer fixes its priority, and a bundler moves rules when it inlines an `@import`. So the two
// evaluations must agree on (1) the declaration that wins for the probe selector `.t`, and (2) the named sublayers of
// every layer, in the order of their first declaration. Every rule is `.t { --k: <file>r<index> }`, so the winning
// value names its rule.
//
// scripts/css-layer-fuzz.ts runs many seeds against a given binary.
import { spawn } from "bun";
import { bunEnv, tempDir } from "harness";

function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type GraphOptions = {
  /** Some files import themselves or a lower-numbered file. Default false. */
  cycles?: boolean;
  /** Some imports have a bare `layer`. Default false. */
  anonymous?: boolean;
  /** Some files have `@layer` statements ahead of their imports. Default true. */
  leadingStatements?: boolean;
  /** Some layer blocks are empty. Default false. */
  emptyBlocks?: boolean;
};

const names = ["a", "b", "c"];
const wrappers = ["w", "v"];

export function generateGraph(
  seed: number,
  options: GraphOptions = {},
): { files: Record<string, string>; entry: string } {
  const { cycles = false, anonymous = false, leadingStatements = true, emptyBlocks = false } = options;
  const rnd = rng(seed);
  const int = (n: number, from = rnd) => Math.floor(from() * n);
  const pick = (pool: string[], from = rnd) => pool[int(pool.length, from)];
  const stem = (i: number) => (i === 0 ? "entry" : `f${i}`);
  const n = 3 + int(5);
  // Each optional shape draws from streams of its own, one per file, so a seed keeps its base graph whatever the
  // options are.
  const own = (shape: number) => Array.from({ length: n }, (_, i) => rng(seed ^ Math.imul(shape * 8 + i, 0x5bd1e995)));
  const [leading, cyclic, anon, empty] = [1, 2, 3, 4].map(own);

  const imports: string[][] = Array.from({ length: n }, () => []);
  const addImport = (i: number, target: number, from = rnd) => {
    const wrapper = from() < 0.5 ? ` layer(${pick(wrappers, from)})` : "";
    const rule = `@import "./${stem(target)}.css"${anonymous && anon[i]() < 0.3 ? " layer" : wrapper};\n`;
    imports[i].splice(int(imports[i].length + 1, from), 0, rule);
  };
  // Every file is imported from one or two places in lower-numbered files. So there is no cycle, and a file that
  // several chains reach is applied several times.
  for (let target = 1; target < n; target++) {
    for (let count = rnd() < 0.65 ? 1 : 2; count > 0; count--) addImport(int(target), target);
  }

  const files: Record<string, string> = {};
  for (let i = 0; i < n; i++) {
    let rules = 0;
    const style = () => `.t { --k: ${stem(i)}r${rules++} }`;
    // A statement or a block can name a wrapper, the way `@layer theme; @import "./theme.css" layer(theme);` does.
    const outer = (from = rnd) => pick(from() < 0.25 ? wrappers : names, from);
    const statement = (from = rnd) => {
      const path = () => outer(from) + (from() < 0.2 ? "." + pick(names, from) : "");
      return `@layer ${[...new Set(Array.from({ length: 1 + int(3, from) }, path))].join(", ")};\n`;
    };
    if (cycles && cyclic[i]() < 0.2) addImport(i, int(i + 1, cyclic[i]), cyclic[i]);
    let css = "";
    if (leadingStatements && imports[i].length && leading[i]() < 0.5) {
      css += statement(leading[i]) + (leading[i]() < 0.4 ? statement(leading[i]) : "");
    }
    css += imports[i].join("");
    for (let items = 1 + int(4); items > 0; items--) {
      if (emptyBlocks && empty[i]() < 0.3) css += `@layer ${outer(empty[i])} {}\n`;
      const kind = int(20);
      if (kind < 5) css += statement();
      else if (kind < 13) css += `@layer ${outer()} { ${style()} }\n`;
      else if (kind < 18) {
        css += `@layer ${outer()} { ${rnd() < 0.5 ? style() + " " : ""}@layer ${pick(names)} { ${style()} } }\n`;
      } else css += style() + "\n";
    }
    files[stem(i) + ".css"] = css;
  }
  return { files, entry: "entry.css" };
}

/**
 * `winner`: the value `.t` gets for `--k`. `order`: layer path ("" is the root) -> its named sublayers, in the order of
 * their first declaration. A layer inside an anonymous layer is left out: no other style sheet can name it, so only
 * the rules in it show where it stands.
 */
export type LayerEvaluation = { winner: string | undefined; order: Record<string, string[]> };

// `name` is "" for an anonymous layer. `path` is undefined for one, and for every layer inside one.
type Layer = { name: string; path?: string; children: Layer[] };

const comment = /\/\*[^]*?\*\//g;
// `@name prelude;` or `@name prelude {`, a style rule, or the `}` of a block. Only `@import` and `@layer` are
// modelled: any other block (`@media`, `@supports`) counts as its content.
const syntax = /@([\w-]+)\s*([^;{}]*?)\s*([;{])|([^{}@;]+)\{([^{}]*)\}|\}/g;
const importPrelude = /^(?:url\(\s*)?["']?(?:\.\/)?([^"')\s]+)["']?\s*\)?\s*(?:(layer)(?:\(\s*([^)\s]+)\s*\))?)?/;

/** The graph as a browser sees it: every `@import` is followed. */
export function evaluateSources(files: Record<string, string>, entry: string): LayerEvaluation {
  const order: Record<string, string[]> = {};
  const root: Layer = { name: "", path: "", children: [] };
  const rules: { layer: Layer; id: string }[] = [];
  // The first mention of a name fixes the place of the layer among its siblings. An anonymous layer is a new one each
  // time.
  const child = (parent: Layer, name: string) => {
    let layer = name ? parent.children.find(sibling => sibling.name === name) : undefined;
    if (!layer) {
      parent.children.push((layer = { name, children: [] }));
      if (name && parent.path !== undefined) {
        layer.path = (parent.path && parent.path + ".") + name;
        (order[parent.path] ??= []).push(name);
      }
    }
    return layer;
  };
  const descend = (from: Layer, path: string) =>
    path.split(".").reduce((layer, name) => child(layer, name.trim()), from);

  const apply = (file: string, into: Layer, chain: string[]) => {
    const stack = [into];
    for (const [, at, prelude, open, selector, declarations] of files[file].replace(comment, "").matchAll(syntax)) {
      const top = stack[stack.length - 1];
      if (at === "import") {
        const [, target = "", layered, wrapper = ""] = importPrelude.exec(prelude) ?? [];
        const layer = layered ? descend(top, wrapper) : top;
        // An import that closes a cycle is not loaded, and neither is a missing file. Its layer is declared anyway.
        if (target in files && !chain.includes(target)) apply(target, layer, [...chain, target]);
      } else if (at === "layer" && open === ";") {
        for (const path of prelude.split(",")) descend(top, path);
      } else if (at) {
        if (open === "{") stack.push(at === "layer" ? descend(top, prelude) : top);
      } else if (selector !== undefined) {
        // The minifier merges adjacent rules into one with several `--k`. The last one wins, as with separate rules.
        for (const [, id] of declarations.matchAll(/--k\s*:\s*([^;\s]+)/g)) rules.push({ layer: top, id });
      } else if (stack.length > 1) stack.pop();
    }
  };
  apply(entry, root, [entry]);

  // A later sibling beats an earlier one, and the rules a layer has itself beat those of its sublayers.
  const rank = new Map<Layer, number>();
  const visit = (layer: Layer) => {
    layer.children.forEach(visit);
    rank.set(layer, rank.size);
  };
  visit(root);
  let winner: { layer: Layer; id: string } | undefined;
  for (const rule of rules) if (!winner || rank.get(rule.layer)! >= rank.get(winner.layer)!) winner = rule;
  return { winner: winner?.id, order };
}

export function evaluateBundle(css: string): LayerEvaluation {
  return evaluateSources({ "bundle.css": css }, "bundle.css");
}

/** Whether `problem` says that `.t` gets another rule. The other problems are about the order of layers. */
export const isWinnerProblem = (problem: string) => problem.startsWith(".t gets ");

export function compare(expected: LayerEvaluation, actual: LayerEvaluation): string[] {
  const problems: string[] = [];
  if (expected.winner !== actual.winner) {
    problems.push(`.t gets ${expected.winner} from the sources and ${actual.winner} from the bundle`);
  }
  for (const parent of new Set([...Object.keys(expected.order), ...Object.keys(actual.order)])) {
    const [sources, bundle] = [expected, actual].map(({ order }) => `[${(order[parent] ?? []).join(", ")}]`);
    if (sources !== bundle) {
      problems.push(`layers of ${parent || "the root"}: ${sources} in the sources, ${bundle} in the bundle`);
    }
  }
  return problems;
}

/** "skipped": the graph could not be bundled (`problems` says why). "wrong": the bundle differs from its sources. */
export type GraphResult = { seed: number; status: "ok" | "wrong" | "skipped"; problems: string[] };

export async function checkGraph(bun: string, seed: number, options?: GraphOptions): Promise<GraphResult> {
  const { files, entry } = generateGraph(seed, options);
  using dir = tempDir("css-layer-order", files);
  await using proc = spawn({
    cmd: [bun, "build", "./" + entry, "--minify"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0 || stderr) {
    return { seed, status: "skipped", problems: [`bun build (exit code ${exitCode}): ` + stderr.slice(0, 400)] };
  }
  const problems = compare(evaluateSources(files, entry), evaluateBundle(stdout));
  if (stdout.includes("@import")) problems.push("the bundle still has an @import");
  return { seed, status: problems.length ? "wrong" : "ok", problems };
}
