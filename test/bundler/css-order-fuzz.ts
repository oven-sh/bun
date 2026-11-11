// Differential check of the order that the CSS bundler gives to rules and cascade layers.
//
// `evaluate` is a small model of CSS Cascading 5 for `@import`, `@layer`, `@media` and `@supports`. It applies a graph of
// CSS files the way a browser does, and it applies a bundle the same way. `generateGraph` makes a random graph in which
// every style rule is `.t { --k: <id> }`. What is compared, for every state of the conditions:
//   normal:    the ids sorted by cascade priority (lowest first), each id at its best occurrence.
//   important: the same order if every declaration were `!important` (layer order reversed).
//   order:     for each named layer, its named sublayers in the order of first declaration.
// Two style sheets with equal observables give every element the same winner for every pair of rules.
//
// An external `@import` is hoisted to the top of a bundle, so a rule of an external style sheet cannot keep its place
// among bundled rules of its own layer. `compare` reports that pair as "pair-hoist", apart from the other kinds.
//
// scripts/css-order-fuzz.ts runs many seeds against a given binary.
export type Node =
  | { type: "import"; url: string; layer?: string; supports?: string; media?: string }
  | { type: "layers"; names: string[] }
  | { type: "block"; at: string; prelude: string; children: Node[] }
  | { type: "style"; selector: string; declarations: string; children: Node[] }
  | { type: "other"; at: string; prelude: string };

export function parse(css: string): Node[] {
  let i = 0;
  const n = css.length;
  const skipWs = () => {
    for (;;) {
      while (i < n && /\s/.test(css[i])) i++;
      if (css.startsWith("/*", i)) {
        const e = css.indexOf("*/", i + 2);
        i = e < 0 ? n : e + 2;
      } else break;
    }
  };
  const readString = (q: string) => {
    let out = "";
    i++;
    while (i < n && css[i] !== q) {
      if (css[i] === "\\") {
        i++;
        const m = /^[0-9a-fA-F]{1,6}/.exec(css.slice(i, i + 6));
        if (m) {
          out += String.fromCodePoint(parseInt(m[0], 16));
          i += m[0].length;
          if (css[i] === " ") i++;
        } else if (css[i] === "\n") i++;
        else out += css[i++];
      } else out += css[i++];
    }
    i++;
    return out;
  };
  const readPrelude = () => {
    const start = i;
    let depth = 0;
    while (i < n) {
      const c = css[i];
      if (c === '"' || c === "'") {
        readString(c);
        continue;
      }
      if (c === "(") depth++;
      else if (c === ")") depth--;
      else if (depth <= 0 && (c === ";" || c === "{" || c === "}")) break;
      i++;
    }
    return css.slice(start, i).trim();
  };
  const parseImport = (): Node => {
    let url = "";
    if (css[i] === '"' || css[i] === "'") url = readString(css[i]);
    else if (css.slice(i, i + 4).toLowerCase() === "url(") {
      i += 4;
      skipWs();
      if (css[i] === '"' || css[i] === "'") {
        url = readString(css[i]);
        skipWs();
        if (css[i] === ")") i++;
      } else {
        const e = css.indexOf(")", i);
        url = css.slice(i, e).trim();
        i = e + 1;
      }
    }
    skipWs();
    let layer: string | undefined;
    let supports: string | undefined;
    if (/^layer(?![\w-])/i.test(css.slice(i, i + 6))) {
      i += 5;
      if (css[i] === "(") {
        const e = css.indexOf(")", i);
        layer = css.slice(i + 1, e).trim();
        i = e + 1;
      } else layer = "";
    }
    skipWs();
    if (/^supports\(/i.test(css.slice(i, i + 9))) {
      i += 8;
      const start = i + 1;
      let depth = 0;
      do {
        const c = css[i];
        if (c === "(") depth++;
        else if (c === ")") depth--;
        i++;
      } while (depth > 0 && i < n);
      supports = css.slice(start, i - 1).trim();
    }
    skipWs();
    const media = readPrelude();
    if (css[i] === ";") i++;
    return { type: "import", url, layer, supports, media: media || undefined };
  };
  const parseList = (top: boolean): Node[] => {
    const out: Node[] = [];
    for (;;) {
      skipWs();
      if (i >= n) break;
      if (css[i] === "}") {
        i++;
        if (top) continue;
        break;
      }
      if (css[i] === "@") {
        i++;
        const at = (/^[\w-]+/.exec(css.slice(i, i + 40)) ?? [""])[0].toLowerCase();
        i += at.length;
        skipWs();
        if (at === "import") {
          out.push(parseImport());
          continue;
        }
        const prelude = readPrelude();
        if (css[i] === ";") {
          i++;
          if (at === "layer") out.push({ type: "layers", names: prelude.split(",").map(s => s.trim()) });
          else out.push({ type: "other", at, prelude });
        } else if (css[i] === "{") {
          i++;
          out.push({ type: "block", at, prelude, children: parseList(false) });
        } else out.push({ type: "other", at, prelude });
        continue;
      }
      const selector = readPrelude();
      if (css[i] === "{") {
        i++;
        const start = i;
        let depth = 1;
        while (i < n && depth > 0) {
          const c = css[i];
          if (c === '"' || c === "'") {
            readString(c);
            continue;
          }
          if (c === "{") depth++;
          else if (c === "}") depth--;
          i++;
        }
        const declarations = css.slice(start, i - 1);
        // A style rule can have rules inside it.
        out.push({
          type: "style",
          selector,
          declarations,
          children: declarations.includes("@") ? parse(declarations) : [],
        });
      } else i++;
    }
    return out;
  };
  return parseList(true);
}

export type Evaluation = {
  normal: string[];
  important: string[];
  order: Record<string, string[]>;
  /** id -> the layer of its best normal occurrence, as a path with "<anon N>" segments. */
  layerOf: Record<string, string>;
  /** The same for its best `!important` occurrence. */
  importantLayerOf: Record<string, string>;
  problems: string[];
};

type Layer = { name: string; path?: string; children: Layer[]; label: string };

export type Files = Record<string, string>;
export type Externals = (url: string) => string | undefined;

// A condition is a key of the state: its text with no white space, and for `supports` with no parentheses around it.
// So `supports(display: grid)` on an import and `@supports (display:grid)` in a bundle are one condition.
const mediaKey = (text: string) => "media " + text.toLowerCase().replace(/\s+/g, "");
const supportsKey = (text: string) => {
  const t = text.toLowerCase().replace(/\s+/g, "");
  return "supports " + (/^\([^()]*\)$/.test(t) ? t.slice(1, -1) : t);
};
const mediaHolds = (text: string, state: ReadonlySet<string>) => {
  const key = mediaKey(text);
  if (key === "media " || key === "media all") return true;
  return key !== "media notall" && state.has(key);
};
const supportsHolds = (text: string, state: ReadonlySet<string>) => state.has(supportsKey(text));

/** The conditions that a CSS text has, also inside its `data:` imports. */
export function conditionKeys(css: string, keys = new Set<string>()): Set<string> {
  const addMedia = (text: string) => {
    const key = mediaKey(text);
    if (key !== "media " && key !== "media all" && key !== "media notall") keys.add(key);
  };
  const walk = (nodes: Node[]) => {
    for (const node of nodes) {
      if (node.type === "import") {
        if (node.media !== undefined) addMedia(node.media);
        if (node.supports !== undefined) keys.add(supportsKey(node.supports));
        const data = decodeDataUrl(node.url);
        if (data !== undefined) walk(parse(data));
      } else if (node.type === "block") {
        if (node.at === "media") addMedia(node.prelude);
        if (node.at === "supports") keys.add(supportsKey(node.prelude));
        if (node.at === "-moz-document") keys.add("document");
        walk(node.children);
      } else if (node.type === "style") walk(node.children);
    }
  };
  walk(parse(css));
  return keys;
}

function decodeDataUrl(url: string): string | undefined {
  const m = /^data:text\/css(;base64)?,/i.exec(url);
  if (!m) return undefined;
  const body = url.slice(m[0].length);
  if (m[1]) return atob(body);
  try {
    return decodeURIComponent(body);
  } catch {
    return body.replace(/%([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  }
}

export function evaluate(
  files: Files,
  entry: string,
  state: ReadonlySet<string> = new Set(),
  externals: Externals = () => undefined,
): Evaluation {
  const order: Record<string, string[]> = {};
  let anon = 0;
  const root: Layer = { name: "", path: "", children: [], label: "" };
  const rules: { layer: Layer; id: string; seq: number }[] = [];
  const problems: string[] = [];
  const child = (parent: Layer, name: string) => {
    let layer = name ? parent.children.find(s => s.name === name) : undefined;
    if (!layer) {
      const label = (parent.label && parent.label + ".") + (name || `<anon ${++anon}>`);
      parent.children.push((layer = { name, children: [], label }));
      if (name && parent.path !== undefined) {
        layer.path = (parent.path && parent.path + ".") + name;
        (order[parent.path] ??= []).push(name);
      }
    }
    return layer;
  };
  const descend = (from: Layer, path: string) =>
    path
      .split(".")
      .map(s => s.trim())
      .filter(Boolean)
      .reduce((layer, name) => child(layer, name), from);

  const apply = (nodes: Node[], into: Layer, chain: string[], top: boolean, where: string) => {
    let canImport = top;
    let sawImport = false;
    for (const node of nodes) {
      switch (node.type) {
        case "import": {
          if (!canImport) {
            problems.push(`invalid @import "${node.url.slice(0, 60)}" in ${where}: it does not apply`);
            break;
          }
          sawImport = true;
          if (node.supports !== undefined && !supportsHolds(node.supports, state)) break;
          if (node.media !== undefined && !mediaHolds(node.media, state)) break;
          const layer =
            node.layer === undefined ? into : node.layer === "" ? child(into, "") : descend(into, node.layer);
          const data = decodeDataUrl(node.url);
          if (data !== undefined) {
            apply(parse(data), layer, chain, true, "a data: import");
          } else if (/^(https?:)?\/\//.test(node.url)) {
            const text = externals(node.url);
            if (text !== undefined) apply(parse(text), layer, chain, true, node.url);
          } else {
            // A file that is not CSS, and an import that closes a cycle, load nothing. The layer is declared anyway.
            const target = new URL(node.url, "file://" + (where.startsWith("/") ? where : "/")).pathname;
            if (target in files && target.endsWith(".css") && !chain.includes(target)) {
              apply(parse(files[target]), layer, [...chain, target], true, target);
            }
          }
          break;
        }
        case "layers":
          if (sawImport) canImport = false;
          for (const name of node.names) descend(into, name);
          break;
        case "other":
          // An at-rule that the browser does not know is dropped, so an `@import` behind it is valid.
          if (node.at === "namespace") canImport = false;
          break;
        case "block": {
          canImport = false;
          if (node.at === "layer") {
            apply(node.children, node.prelude ? descend(into, node.prelude) : child(into, ""), chain, false, where);
          } else if (node.at === "media") {
            if (mediaHolds(node.prelude, state)) apply(node.children, into, chain, false, where);
          } else if (node.at === "supports") {
            if (supportsHolds(node.prelude, state)) apply(node.children, into, chain, false, where);
          } else if (node.at === "-moz-document") {
            if (state.has("document")) apply(node.children, into, chain, false, where);
          } else if (["container", "scope", "starting-style"].includes(node.at)) {
            // A layer inside one of these rules is declared also where the rule does not apply.
            apply(node.children, into, chain, false, where);
          }
          break;
        }
        case "style":
          canImport = false;
          apply(node.children, into, chain, false, where);
          for (const [, id] of node.children.length ? [] : node.declarations.matchAll(/--k\s*:\s*([^;\s}]+)/g)) {
            rules.push({ layer: into, id, seq: rules.length });
          }
          break;
      }
    }
  };
  apply(parse(files[entry]), root, [entry], true, entry);

  // A later sibling beats an earlier one. The rules a layer has itself beat those of its sublayers.
  const rank = new Map<Layer, number>();
  const visit = (layer: Layer) => {
    layer.children.forEach(visit);
    rank.set(layer, rank.size);
  };
  visit(root);

  const bestNormal = new Map<string, { rank: number; seq: number; layer: Layer }>();
  const bestImportant = new Map<string, { rank: number; seq: number; layer: Layer }>();
  for (const rule of rules) {
    const r = rank.get(rule.layer)!;
    const n = bestNormal.get(rule.id);
    if (!n || r > n.rank || (r === n.rank && rule.seq > n.seq))
      bestNormal.set(rule.id, { rank: r, seq: rule.seq, layer: rule.layer });
    const im = bestImportant.get(rule.id);
    // Among important declarations an earlier layer wins, and in one layer the later declaration wins.
    if (!im || r < im.rank || (r === im.rank && rule.seq > im.seq))
      bestImportant.set(rule.id, { rank: r, seq: rule.seq, layer: rule.layer });
  }
  const normal = [...bestNormal].sort(([, a], [, b]) => a.rank - b.rank || a.seq - b.seq).map(([id]) => id);
  const important = [...bestImportant].sort(([, a], [, b]) => b.rank - a.rank || a.seq - b.seq).map(([id]) => id);
  const layerOf: Record<string, string> = {};
  for (const [id, { layer }] of bestNormal) layerOf[id] = layer.label;
  const importantLayerOf: Record<string, string> = {};
  for (const [id, { layer }] of bestImportant) importantLayerOf[id] = layer.label;
  return { normal, important, order, layerOf, importantLayerOf, problems };
}

export type Problem = { kind: "pair" | "pair-hoist" | "important" | "layers" | "invalid"; text: string };

/** `isExternal(id)`: the rule of an external file. A pair with one, both in one layer in the sources, cannot keep its order under a hoist. */
export function compare(expected: Evaluation, actual: Evaluation, isExternal: (id: string) => boolean): Problem[] {
  const problems: Problem[] = [];
  for (const text of actual.problems) problems.push({ kind: "invalid", text });
  const pairs = (list: string[], other: string[], kind: "pair" | "important") => {
    const pos = new Map(other.map((id, i) => [id, i]));
    const missing = list.filter(id => !pos.has(id));
    const extra = other.filter(id => !list.includes(id));
    if (missing.length) problems.push({ kind, text: `${kind}: the bundle has no rule ${missing.join(", ")}` });
    if (extra.length) problems.push({ kind, text: `${kind}: the bundle has the extra rule ${extra.join(", ")}` });
    for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) {
        const [lo, hi] = [list[a], list[b]];
        if (!pos.has(lo) || !pos.has(hi)) continue;
        if (pos.get(lo)! > pos.get(hi)!) {
          const layerOf = kind === "pair" ? expected.layerOf : expected.importantLayerOf;
          const hoist = (isExternal(lo) || isExternal(hi)) && layerOf[lo] === layerOf[hi];
          problems.push({
            kind: hoist ? "pair-hoist" : kind,
            text: `${kind}: ${hi} beats ${lo} in the sources, and ${lo} beats ${hi} in the bundle`,
          });
        }
      }
    }
  };
  pairs(expected.normal, actual.normal, "pair");
  pairs(expected.important, actual.important, "important");
  for (const parent of new Set([...Object.keys(expected.order), ...Object.keys(actual.order)])) {
    const [sources, bundle] = [expected, actual].map(({ order }) => `[${(order[parent] ?? []).join(", ")}]`);
    if (sources !== bundle) {
      problems.push({
        kind: "layers",
        text: `layers of ${parent || "the root"}: ${sources} in the sources, ${bundle} in the bundle`,
      });
    }
  }
  return problems;
}

export type GraphOptions = {
  cycles?: boolean;
  anonymous?: boolean; // bare `layer` imports
  leadingStatements?: boolean; // default true
  emptyBlocks?: boolean;
  conditions?: boolean; // `@media` / `@supports` blocks in a file
  importConditions?: boolean; // `supports()` / media on an `@import`
  external?: boolean; // external imports
  externalRules?: boolean; // each external file has one rule (else it is empty)
  externalLayers?: boolean; // an external file can declare layers, and its rule can be in one
  assets?: boolean; // imports of an .svg
  anonBlocks?: boolean; // `@layer { ... }` blocks
  emptyFiles?: boolean;
};

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

const names = ["a", "b", "c"];
const wrappers = ["w", "v"];

export function generateGraph(seed: number, options: GraphOptions = {}) {
  const {
    cycles = false,
    anonymous = false,
    leadingStatements = true,
    emptyBlocks = false,
    conditions = false,
    importConditions = false,
    external = false,
    externalRules = false,
    externalLayers = false,
    assets = false,
    anonBlocks = false,
    emptyFiles = false,
  } = options;
  const rnd = rng(seed);
  const int = (n: number, from = rnd) => Math.floor(from() * n);
  const pick = (pool: string[], from = rnd) => pool[int(pool.length, from)];
  const stem = (i: number) => (i === 0 ? "entry" : `f${i}`);
  const n = 3 + int(5);
  // Each optional shape draws from streams of its own, one per file, so a seed keeps its base graph whatever the options are.
  const own = (shape: number) => Array.from({ length: n }, (_, i) => rng(seed ^ Math.imul(shape * 8 + i, 0x5bd1e995)));
  const [leading, cyclic, anon, empty, conditional, ext, asset, impcond, anonblock, emptyfile] = [
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
  ].map(own);

  const imports: string[][] = Array.from({ length: n }, () => []);
  const externals: string[] = [];
  const importTail = (i: number, from: () => number) => {
    let tail = "";
    if (anonymous && anon[i]() < 0.3) tail += " layer";
    else if (from() < 0.5) tail += ` layer(${pick(wrappers, from)})`;
    if (importConditions && impcond[i]() < 0.3) {
      const f = impcond[i];
      if (f() < 0.4) tail += ` supports(top: ${1 + int(2, f)}px)`;
      else tail += ` (min-width: ${1 + int(2, f)}px)`;
    }
    return tail;
  };
  const addImport = (i: number, url: string, from = rnd) => {
    const rule = `@import "${url}"${importTail(i, from)};\n`;
    imports[i].splice(int(imports[i].length + 1, from), 0, rule);
  };
  // Every file is imported from one or two places in lower-numbered files. So there is no cycle, and a file that
  // several chains reach is applied several times.
  for (let target = 1; target < n; target++) {
    for (let count = rnd() < 0.65 ? 1 : 2; count > 0; count--) addImport(int(target), `./${stem(target)}.css`);
  }

  const files: Record<string, string> = {};
  for (let i = 0; i < n; i++) {
    let rules = 0;
    const style = () => `.t { --k: ${stem(i)}r${rules++} }`;
    const outer = (from = rnd) => pick(from() < 0.25 ? wrappers : names, from);
    const statement = (from = rnd) => {
      const path = () => outer(from) + (from() < 0.2 ? "." + pick(names, from) : "");
      return `@layer ${[...new Set(Array.from({ length: 1 + int(3, from) }, path))].join(", ")};\n`;
    };
    if (cycles && cyclic[i]() < 0.2) addImport(i, `./${stem(int(i + 1, cyclic[i]))}.css`, cyclic[i]);
    if (external) {
      for (let k = ext[i]() < 0.35 ? 1 + int(2, ext[i]) : 0; k > 0; k--) {
        // A few URLs are shared, so one external file can be imported from several places.
        const name = `e${1 + int(3, ext[i])}`;
        if (!externals.includes(name)) externals.push(name);
        addImport(i, `https://example.com/${name}.css`, ext[i]);
      }
    }
    if (assets && asset[i]() < 0.2) {
      files["/a1.svg"] = "<svg/>";
      addImport(i, "./a1.svg", asset[i]);
    }
    let css = "";
    if (leadingStatements && imports[i].length && leading[i]() < 0.5) {
      css += statement(leading[i]) + (leading[i]() < 0.4 ? statement(leading[i]) : "");
    }
    css += imports[i].join("");
    let lastSupports = 0;
    const isEmpty = emptyFiles && i > 0 && emptyfile[i]() < 0.15;
    for (let items = isEmpty ? 0 : 1 + int(4); items > 0; items--) {
      if (emptyBlocks && empty[i]() < 0.3) css += `@layer ${outer(empty[i])} {}\n`;
      const kind = int(20);
      let item: string;
      if (kind < 5) item = statement();
      else if (kind < 13) item = `@layer ${outer()} { ${style()} }\n`;
      else if (kind < 18) {
        item = `@layer ${outer()} { ${rnd() < 0.5 ? style() + " " : ""}@layer ${pick(names)} { ${style()} } }\n`;
      } else item = style() + "\n";
      if (anonBlocks && anonblock[i]() < 0.15) item = `@layer { ${item.trim()} }\n`;
      const from = conditional[i];
      if (conditions && from() < 0.35) {
        const media = from() < 0.7;
        let number = 1 + int(2, from);
        // The minifier drops the second of two adjacent `@supports` rules with one condition.
        if (!media && number === lastSupports) number = 3 - number;
        lastSupports = media ? 0 : number;
        item = `@${media ? `media (min-width: ${number}px)` : `supports (top: ${number}px)`} { ${item.trim()} }\n`;
      } else lastSupports = 0;
      css += item;
    }
    files[`/${stem(i)}.css`] = css;
  }
  // What each external URL serves. It is the same for the sources and for the bundle.
  const externalSheets: Record<string, string> = {};
  for (const name of externals) {
    const from = rng(seed ^ Math.imul(Number(name.slice(1)) + 77, 0x5bd1e995));
    const rule = externalRules ? `.t { --k: ${name} }` : "";
    let css = rule;
    if (externalLayers) {
      const kind = int(5, from);
      const layer = pick(from() < 0.25 ? wrappers : names, from);
      if (kind === 1) css = `@layer ${layer} { ${rule} }`;
      else if (kind === 2) css = `@layer ${layer}, ${pick(names, from)};\n${rule}`;
      else if (kind === 3) css = `@layer ${layer} { @layer ${pick(names, from)} { ${rule} } }`;
    }
    externalSheets[name] = css;
  }
  return { files, entry: "/entry.css", externalSheets };
}

/** What the bundle of `files` does not have as its sources have it, over every state of the conditions. */
export function cascadeProblems(
  files: Files,
  entry: string,
  bundle: string,
  externalSheets: Record<string, string> = {},
): Problem[] {
  const external = (url: string) => externalSheets[/\/(e\d+)\.css$/.exec(url)?.[1] ?? ""];
  const isExternal = (id: string) => /^e\d+$/.test(id);
  const keys = new Set<string>();
  for (const css of [...Object.values(files), bundle]) conditionKeys(css, keys);
  const list = [...keys].sort();
  const problems: Problem[] = [];
  const seen = new Set<string>();
  for (let bits = 0; bits < 1 << list.length; bits++) {
    const state = new Set(list.filter((_, i) => bits & (1 << i)));
    const where = list.length ? ` (conditions that hold: ${[...state].join(", ") || "none"})` : "";
    const expected = evaluate(files, entry, state, external);
    const actual = evaluate({ "/bundle.css": bundle }, "/bundle.css", state, external);
    for (const problem of compare(expected, actual, isExternal)) {
      const text = problem.text + where;
      if (seen.has(text)) continue;
      seen.add(text);
      problems.push({ kind: problem.kind, text });
    }
  }
  return problems;
}
