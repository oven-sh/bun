// What TypeScript says the type at every node of every type-aware test case is, to compare with
// `bun-lint types dump-fixtures`.
//
//   TYPESCRIPT_ESLINT_DIR=<checkout> BUN_LINT_TYPE_ROOTS=<a,b> bun dump-types.ts <fixtures> [--rule=r] [--jobs=n] --out=<file>
//
// For each case: `# <rule> <index>`, then one line `[start, end, "<ESTree type>", "<type>"]` for each
// ESTree node, with offsets in UTF-8 bytes. The type is
// `checker.typeToString(services.getTypeAtLocation(node))`.

import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { availableParallelism } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const flag = (name: string) => process.argv.find(a => a.startsWith(name))?.slice(name.length);
const fixtures = resolve(process.argv.slice(2).find(a => !a.startsWith("--"))!);
const out = flag("--out=")!;
const shard = flag("--shard=");

if (!shard) {
  const jobs = Number(flag("--jobs=") ?? availableParallelism());
  const script = fileURLToPath(import.meta.url);
  const rest = process.argv.slice(2).filter(a => !a.startsWith("--out=") && !a.startsWith("--jobs="));
  const children = Array.from({ length: jobs }, (_, i) =>
    Bun.spawn([process.execPath, script, ...rest, `--shard=${i}/${jobs}`, `--out=${out}.${i}`], {
      stdio: ["ignore", "inherit", "inherit"],
    }),
  );
  await Promise.all(children.map(child => child.exited));
  const sections = new Map<string, string>();
  for (let i = 0; i < jobs; i++) {
    for (const section of readFileSync(`${out}.${i}`, "utf8").split(/^(?=# )/m)) {
      if (section) sections.set(section.slice(0, section.indexOf("\n")), section);
    }
    spawnSync("rm", ["-f", `${out}.${i}`]);
  }
  const key = (header: string) => {
    const [, rule, index] = header.split(" ");
    return [rule, Number(index)] as const;
  };
  const headers = [...sections.keys()].sort((a, b) => {
    const [ruleA, indexA] = key(a);
    const [ruleB, indexB] = key(b);
    return ruleA < ruleB ? -1 : ruleA > ruleB ? 1 : indexA - indexB;
  });
  writeFileSync(out, headers.map(header => sections.get(header)).join(""));
  process.exit();
}

const [shardIndex, shardCount] = shard.split("/").map(Number);
const require = createRequire(join(process.env.TYPESCRIPT_ESLINT_DIR!, "packages/eslint-plugin/package.json"));
const ts: typeof import("typescript") = require("typescript");
const { parseAndGenerateServices, simpleTraverse } = require("@typescript-eslint/typescript-estree");

const projectDir = join(fixtures, "typescript-eslint-project");
const typeRoots = process.env.BUN_LINT_TYPE_ROOTS?.split(",");
const onlyRule = flag("--rule=");

const configs = new Map<string, import("typescript").ParsedCommandLine>();
function configOf(path: string) {
  let config = configs.get(path);
  if (!config) {
    const read = ts.readConfigFile(path, ts.sys.readFile);
    config = ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(path), typeRoots && { typeRoots }, path);
    configs.set(path, config);
  }
  return config;
}

// Everything but the file under test is parsed once per set of options.
const sourceFiles = new Map<string, import("typescript").SourceFile | undefined>();
const oldPrograms = new Map<string, import("typescript").Program>();

function programOf(configPath: string, filePath: string, code: string) {
  const config = configOf(configPath);
  const host = ts.createCompilerHost(config.options, true);
  const getSourceFile = host.getSourceFile;
  host.getSourceFile = (fileName, languageVersionOrOptions, ...rest) => {
    if (fileName === filePath) {
      return ts.createSourceFile(fileName, code, languageVersionOrOptions, true);
    }
    const key = `${configPath}\0${fileName}`;
    if (!sourceFiles.has(key)) {
      sourceFiles.set(key, getSourceFile.call(host, fileName, languageVersionOrOptions, ...rest));
    }
    return sourceFiles.get(key);
  };
  host.fileExists = fileName => fileName === filePath || ts.sys.fileExists(fileName);
  host.readFile = fileName => (fileName === filePath ? code : ts.sys.readFile(fileName));
  const rootNames = config.fileNames.includes(filePath) ? config.fileNames : [...config.fileNames, filePath];
  const program = ts.createProgram({ rootNames, options: config.options, host, oldProgram: oldPrograms.get(configPath) });
  oldPrograms.set(configPath, program);
  return program;
}

const encoder = new TextEncoder();
/** For each UTF-16 offset of `code`, the offset in its UTF-8 form. */
function byteOffsets(code: string) {
  if (!/[^\0-\x7f]/.test(code)) return undefined;
  const offsets = new Uint32Array(code.length + 1);
  let bytes = 0;
  for (let i = 0; i < code.length; ) {
    const char = String.fromCodePoint(code.codePointAt(i)!);
    for (let j = 0; j < char.length; j++) offsets[i + j] = bytes;
    bytes += encoder.encode(char).length;
    i += char.length;
  }
  offsets[code.length] = bytes;
  return offsets;
}

let text = "";
let count = 0;
for (const name of readdirSync(join(fixtures, "typescript-eslint")).sort()) {
  const rule = name.replace(/\.json$/, "");
  if (onlyRule && onlyRule !== rule) continue;
  const fixture = JSON.parse(readFileSync(join(fixtures, "typescript-eslint", name), "utf8"));
  fixture.cases.forEach((testCase: any, index: number) => {
    if (!testCase.typeAware || testCase.skip != null) return;
    if (count++ % shardCount !== shardIndex) return;
    text += `# ${rule} ${index}\n`;
    const filePath = join(projectDir, testCase.filename);
    try {
      const program = programOf(join(projectDir, testCase.tsconfig), filePath, testCase.code);
      const { ast, services } = parseAndGenerateServices(testCase.code, {
        filePath,
        programs: [program],
        range: true,
        jsx: filePath.endsWith("x"),
        disallowAutomaticSingleRunInference: true,
      });
      const checker = program.getTypeChecker();
      const offsets = byteOffsets(testCase.code);
      const lines: [number, number, string, string][] = [];
      simpleTraverse(ast, {
        enter(node: any) {
          if (node.type === "Program") return;
          let type: string;
          try {
            type = checker.typeToString(services.getTypeAtLocation(node));
          } catch (error) {
            type = `!${error}`;
          }
          const [start, end] = node.range;
          lines.push([offsets ? offsets[start] : start, offsets ? offsets[end] : end, node.type, type]);
        },
      });
      lines.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      for (const line of lines) text += JSON.stringify(line) + "\n";
    } catch (error) {
      text += JSON.stringify(`failed: ${error}`) + "\n";
    }
  });
}
writeFileSync(out, text);
