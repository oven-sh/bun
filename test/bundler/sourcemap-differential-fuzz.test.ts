// Seeded fuzz of the source maps Bun.build emits, decoded by the independent
// `source-map` library. Random small programs (an entry plus the modules it
// imports, with random layout, comments and non-ASCII text shifting columns)
// are bundled, then every identifier in the output that has a mapping must map
// to that same identifier in the original file, and every mapping must land
// inside its original file. Replay a failure with BUN_SOURCEMAP_FUZZ_SEED=<seed>;
// soak with BUN_SOURCEMAP_FUZZ_ITERS=<n> (one iteration is one program).
import { fuzzEnv, Rng } from "_util/fuzz";
import { expect, test } from "bun:test";
import { tempDir } from "harness";
import { join } from "node:path";
import { SourceMapConsumer } from "source-map";

const PROGRAMS_PER_BUILD = 2;
/** Each build takes the next of these in turn; the defaults below are multiples of a full rotation. */
const BUILD_OPTIONS: Partial<Parameters<typeof Bun.build>[0]>[] = [
  { format: "esm" },
  { format: "iife" },
  { format: "cjs" },
  // Whitespace minification puts several modules on one generated line.
  { format: "esm", minify: { whitespace: true } },
  { format: "iife", minify: { whitespace: true } },
];
const ROTATION = PROGRAMS_PER_BUILD * BUILD_OPTIONS.length;
const fuzz = fuzzEnv("BUN_SOURCEMAP_FUZZ", 0x736d6170, { release: ROTATION * 5, debug: ROTATION });

/** Comment and string contents; must not contain any generated identifier (or `console`/`log`). */
const FILLER = ["日本語", "🎉", "é", "...", "1 + 1", "*", "'", '"', "\\u00e9", "中文 text", "ñ"];
const IDENTIFIERS = /[A-Za-z_$][\w$]*/g;
const IDENTIFIER_AT = /[A-Za-z_$][\w$]*/y;

interface Module {
  /** Path relative to the build root, e.g. "p3/dep0.js"; the map's `sources` entry for it ends with this. */
  file: string;
  source: string;
}

interface Program {
  entry: string;
  modules: Module[];
  /** Identifiers this program declares or references; all unique across the run. */
  words: Set<string>;
}

/** Everything declared so far in one module (plus its imports), to build expressions from. */
interface Scope {
  values: string[];
  functions: { name: string; arity: number }[];
  objects: { name: string; keys: string[] }[];
  classes: { name: string; method: string }[];
}

class ProgramGenerator {
  private counter = 0;
  constructor(private rng: Rng) {}

  private name(prefix: string, words: Set<string>): string {
    const name = `${prefix}${this.counter++}`;
    words.add(name);
    return name;
  }

  /** Whitespace between tokens: usually a space, sometimes a comment or a line break. */
  private gap(): string {
    const rng = this.rng;
    if (rng.chance(0.1)) return ` /* ${rng.pick(FILLER)} */ `;
    if (rng.chance(0.05)) return "\n" + rng.string(["  ", "\t", ""], rng.range(1, 3));
    return rng.chance(0.1) ? "  " : " ";
  }

  private stringLiteral(): string {
    const rng = this.rng;
    const body = rng.pick(FILLER).replaceAll("\\", "\\\\").replaceAll("'", "\\'").replaceAll('"', '\\"');
    switch (rng.int(3)) {
      case 0:
        return `"${body}"`;
      case 1:
        return `'${body}'`;
      default:
        return "`" + body + "`";
    }
  }

  private expr(scope: Scope, depth: number): string {
    const rng = this.rng;
    const g = () => this.gap();
    const sub = () => this.expr(scope, depth - 1);
    const choice = depth > 0 ? rng.int(9) : rng.int(3);
    switch (choice) {
      case 0:
        return String(rng.int(1000));
      case 1:
        return this.stringLiteral();
      case 2:
        return scope.values.length > 0 ? rng.pick(scope.values) : String(rng.int(10));
      case 3:
        return `${sub()}${g()}+${g()}${sub()}`;
      case 4: {
        if (scope.functions.length === 0) return sub();
        const fn = rng.pick(scope.functions);
        const args: string[] = [];
        for (let i = 0; i < fn.arity; i++) args.push(sub());
        return `${fn.name}(${args.join("," + g())})`;
      }
      case 5: {
        if (scope.objects.length === 0) return sub();
        const obj = rng.pick(scope.objects);
        return `${obj.name}${rng.chance(0.1) ? g() : ""}.${rng.pick(obj.keys)}`;
      }
      case 6: {
        if (scope.classes.length === 0) return sub();
        const cls = rng.pick(scope.classes);
        return `new ${cls.name}().${cls.method}(${sub()})`;
      }
      case 7:
        return `[${sub()},${g()}${sub()}]`;
      default:
        return `(${sub()}${g()}?${g()}${sub()}${g()}:${g()}${sub()})`;
    }
  }

  /** One top-level declaration; returns its source and registers it in `scope`. */
  private declaration(scope: Scope, words: Set<string>, exported: boolean): { code: string; name: string } {
    const rng = this.rng;
    const g = () => this.gap();
    const prefix = exported ? "export" + g() : "";
    switch (rng.int(5)) {
      case 0:
      case 1: {
        const name = this.name("v", words);
        const code = `${prefix}${rng.pick(["const", "let", "var"])} ${name}${g()}=${g()}${this.expr(scope, 2)};`;
        scope.values.push(name);
        return { code, name };
      }
      case 2: {
        const name = this.name("fn", words);
        const arity = rng.int(3);
        const params: string[] = [];
        for (let i = 0; i < arity; i++) params.push(this.name("p", words));
        const inner: Scope = { ...scope, values: scope.values.concat(params) };
        let body = "";
        if (rng.chance(0.4)) {
          const local = this.name("v", words);
          body += `${g()}const ${local}${g()}=${g()}${this.expr(inner, 1)};\n`;
          inner.values = inner.values.concat(local);
        }
        body += `${g()}return ${this.expr(inner, 2)};`;
        const code = `${prefix}function ${name}(${params.join("," + g())})${g()}{\n${body}\n}`;
        scope.functions.push({ name, arity });
        return { code, name };
      }
      case 3: {
        const name = this.name("o", words);
        const keys: string[] = [];
        const count = rng.range(1, 3);
        let code = `${prefix}const ${name}${g()}=${g()}{`;
        for (let i = 0; i < count; i++) {
          if (i > 0) code += ",";
          if (scope.values.length > 0 && rng.chance(0.15)) {
            // Shorthand property: the key is a value declared earlier.
            const value = rng.pick(scope.values);
            keys.push(value);
            code += `${g()}${value}`;
          } else {
            const key = this.name("k", words);
            keys.push(key);
            code += `${g()}${key}:${g()}${this.expr(scope, 1)}`;
          }
        }
        code += `${g()}};`;
        scope.objects.push({ name, keys });
        return { code, name };
      }
      default: {
        const name = this.name("C", words);
        const field = this.name("f", words);
        const method = this.name("m", words);
        const param = this.name("p", words);
        const inner: Scope = { ...scope, values: scope.values.concat(param) };
        const code =
          `${prefix}class ${name}${g()}{\n` +
          `${g()}${field}${g()}=${g()}${this.expr(scope, 1)};\n` +
          `${g()}${method}(${param})${g()}{\n` +
          `${g()}return this.${field}${g()}+${g()}${this.expr(inner, 1)};\n` +
          `${g()}}\n}`;
        scope.classes.push({ name, method });
        return { code, name };
      }
    }
  }

  private module(
    scope: Scope,
    words: Set<string>,
    imports: { file: string; names: string[] }[],
    exportAll: boolean,
  ): { source: string; exported: string[] } {
    const rng = this.rng;
    const statements: string[] = imports.map(
      ({ file, names }) => `import {${this.gap()}${names.join("," + this.gap())}${this.gap()}} from "./${file}";`,
    );
    const exported: string[] = [];
    const declared: string[] = [];
    const count = rng.range(1, 5);
    for (let i = 0; i < count; i++) {
      const isExported = exportAll || rng.chance(0.2);
      const { code, name } = this.declaration(scope, words, isExported);
      statements.push(code);
      declared.push(name);
      if (isExported) exported.push(name);
    }
    // Using every name keeps all of it, and everything it imports, out of the tree shaker's reach.
    const used = declared.concat(imports.flatMap(i => i.names));
    statements.push(`console.log(${used.join("," + this.gap())});`);
    words.add("console").add("log");

    const eol = rng.chance(0.2) ? "\r\n" : "\n";
    let source = "";
    for (const statement of statements) {
      source += rng.pick(["", " ", "  ", "    ", "\t"]) + statement.replaceAll("\n", eol) + eol;
      if (rng.chance(0.3)) source += eol;
      if (rng.chance(0.1)) source += `// ${rng.pick(FILLER)}${eol}`;
    }
    return { source, exported };
  }

  program(dir: string): Program {
    const words = new Set<string>();
    const modules: Module[] = [];
    const imports: { file: string; names: string[] }[] = [];
    const entryScope: Scope = { values: [], functions: [], objects: [], classes: [] };
    const depCount = this.rng.int(3);
    for (let i = 0; i < depCount; i++) {
      const depScope: Scope = { values: [], functions: [], objects: [], classes: [] };
      const { source, exported } = this.module(depScope, words, [], true);
      const file = `dep${i}.js`;
      modules.push({ file: `${dir}/${file}`, source });
      imports.push({ file, names: exported });
      // Whatever the dependency declared is usable from the entry under the same name.
      entryScope.values.push(...depScope.values);
      entryScope.functions.push(...depScope.functions);
      entryScope.objects.push(...depScope.objects);
      entryScope.classes.push(...depScope.classes);
    }
    const entry = `${dir}/entry.js`;
    modules.push({ file: entry, source: this.module(entryScope, words, imports, false).source });
    return { entry, modules, words };
  }
}

/** 1-based line and 0-based column, as `source-map` reports both sides of a mapping. */
function inRange(lines: string[], line: number, column: number): boolean {
  return line >= 1 && line <= lines.length && column >= 0 && column <= lines[line - 1].length;
}

/** The identifier starting exactly at `column`, if any. */
function identifierAt(text: string, column: number): string | null {
  IDENTIFIER_AT.lastIndex = column;
  return IDENTIFIER_AT.exec(text)?.[0] ?? null;
}

interface Stats {
  mappings: number;
  identifiers: number;
}

interface Original {
  file: string;
  line: number;
  column: number;
  name: string | null;
}

async function checkProgram(program: Program, generated: string, map: any, stats: Stats, repro: string): Promise<void> {
  const originals = new Map<string, string[]>();
  for (const module of program.modules) originals.set(module.file, module.source.split(/\r?\n/));
  // The map names sources relative to the build root; consumer.sources may
  // prefix them differently from map.sources, so both are matched by suffix.
  const fileOfSource = (source: string): string => {
    const normalized = source.replaceAll("\\", "/");
    for (const file of originals.keys()) {
      if (normalized === file || normalized.endsWith("/" + file)) return file;
    }
    throw new Error(
      `map names source ${JSON.stringify(source)}, which is not one of ${[...originals.keys()]}. ${repro}`,
    );
  };

  for (let i = 0; i < map.sources.length; i++) {
    const file = fileOfSource(map.sources[i]);
    expect(map.sourcesContent[i], `sourcesContent for ${file}. ${repro}`).toBe(
      program.modules.find(m => m.file === file)!.source,
    );
  }

  const generatedLines = generated.split("\n");
  await SourceMapConsumer.with(map, null, consumer => {
    const fileOf = new Map<string, string>(consumer.sources.map(source => [source, fileOfSource(source)]));
    const atGenerated = new Map<string, Original>();
    consumer.eachMapping(m => {
      stats.mappings++;
      const file = fileOf.get(m.source);
      const where = () =>
        `mapping ${m.generatedLine}:${m.generatedColumn} -> ${m.source}:${m.originalLine}:${m.originalColumn}. ${repro}`;
      if (file === undefined) throw new Error(`unknown source in ${where()}`);
      if (!inRange(generatedLines, m.generatedLine, m.generatedColumn)) {
        throw new Error(`generated position is outside the output (${generatedLines.length} lines): ${where()}`);
      }
      if (!inRange(originals.get(file)!, m.originalLine, m.originalColumn)) {
        throw new Error(`original position is outside ${file} (${originals.get(file)!.length} lines): ${where()}`);
      }
      const key = `${m.generatedLine}:${m.generatedColumn}`;
      const previous = atGenerated.get(key);
      if (
        previous !== undefined &&
        (previous.file !== file || previous.line !== m.originalLine || previous.column !== m.originalColumn)
      ) {
        throw new Error(
          `same generated position also maps to ${previous.file}:${previous.line}:${previous.column}: ${where()}`,
        );
      }
      atGenerated.set(key, { file, line: m.originalLine, column: m.originalColumn, name: m.name });
    });

    for (let lineNumber = 1; lineNumber <= generatedLines.length; lineNumber++) {
      for (const match of generatedLines[lineNumber - 1].matchAll(IDENTIFIERS)) {
        const word = match[0];
        if (!program.words.has(word)) continue;
        const mapping = atGenerated.get(`${lineNumber}:${match.index}`);
        if (mapping === undefined) continue;
        stats.identifiers++;
        const originalLine = originals.get(mapping.file)![mapping.line - 1];
        const original = identifierAt(originalLine, mapping.column);
        if (original !== word) {
          throw new Error(
            `generated ${lineNumber}:${match.index} is \`${word}\` but maps to ${mapping.file}:${mapping.line}:${mapping.column}, ` +
              `which is ${original === null ? JSON.stringify(originalLine.slice(mapping.column, mapping.column + 20)) : "`" + original + "`"}. ${repro}`,
          );
        }
        // Bun does not emit names today; if it starts to, the name must be this identifier.
        if (mapping.name !== null)
          expect(mapping.name, `name of mapping at ${lineNumber}:${match.index}. ${repro}`).toBe(word);
      }
    }
  });
}

/** An in-memory artifact's path ("./p3/entry.js", or with the host's separators) as a build-root relative name. */
function outputName(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

test(`Bun.build source maps point every mapped identifier back at itself ${fuzz.label}`, async () => {
  const rng = new Rng(fuzz.seed);
  const generator = new ProgramGenerator(rng);
  const stats: Stats = { mappings: 0, identifiers: 0 };

  for (let first = 0; first < fuzz.iters; first += PROGRAMS_PER_BUILD) {
    const options = BUILD_OPTIONS[(first / PROGRAMS_PER_BUILD) % BUILD_OPTIONS.length];
    const programs: Program[] = [];
    const files: Record<string, string> = {};
    for (let i = first; i < Math.min(first + PROGRAMS_PER_BUILD, fuzz.iters); i++) {
      const program = generator.program(`p${i}`);
      programs.push(program);
      for (const module of program.modules) files[module.file] = module.source;
    }
    using dir = tempDir("sourcemap-fuzz", files);

    const build = await Bun.build({
      ...options,
      entrypoints: programs.map(p => join(String(dir), p.entry)),
      root: String(dir),
      sourcemap: "external",
    });

    for (const [offset, program] of programs.entries()) {
      const iteration = first + offset;
      const repro = `${fuzz.repro(iteration)} options=${JSON.stringify(options)}`;
      const js = build.outputs.find(o => o.kind === "entry-point" && outputName(o.path) === program.entry);
      expect(js, `no output for ${program.entry} in ${build.outputs.map(o => o.path)}. ${repro}`).toBeDefined();
      // Known divergence (pinned below): with several entrypoints `js.sourcemap`
      // is the wrong artifact, so the map is paired by path instead.
      const map = build.outputs.find(o => o.kind === "sourcemap" && o.path === js!.path + ".map");
      expect(map, `no source map for ${js!.path} in ${build.outputs.map(o => o.path)}. ${repro}`).toBeDefined();
      await checkProgram(program, await js!.text(), await map!.json(), stats, repro);
    }
  }

  console.log(
    `sourcemap-differential-fuzz: ${fuzz.iters} programs, ${stats.mappings} mappings in range, ${stats.identifiers} identifiers mapped to themselves`,
  );
  // Guards against the check silently going vacuous: every program has at least
  // a console.log line worth of mapped identifiers.
  expect(stats.identifiers).toBeGreaterThan(fuzz.iters * 4);
});

// A fix is in flight. Once this passes, delete it and read each program's map
// through `js.sourcemap` above, so the fuzz covers that link as well.
test.failing("known divergence: BuildArtifact.sourcemap with several entrypoints", async () => {
  using dir = tempDir("sourcemap-fuzz-link", { "a.js": "console.log(1);\n", "b.js": "console.log(2);\n" });
  const build = await Bun.build({
    entrypoints: [join(String(dir), "a.js"), join(String(dir), "b.js")],
    root: String(dir),
    sourcemap: "external",
  });
  for (const js of build.outputs.filter(o => o.kind === "entry-point")) {
    expect(js.sourcemap?.path).toBe(js.path + ".map");
  }
});
