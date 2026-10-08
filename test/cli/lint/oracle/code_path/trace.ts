// Compares the code path analysis of `bun-lint code-path batch` with ESLint's: every event in order, among the nodes
// that are entered and left, and the graph of each code path when it ends.
//
//   bun trace.ts --bin <bun-lint> --eslint <checkout> --typescript-eslint <checkout> --scratch <dir>
//                [--fixtures <conformance/fixtures>].. [--files <dir>].. [--only <regex of case ids>]
//                [--jobs N] [--examples N] [--ignore-nodes]
//   bun trace.ts --eslint <checkout> --typescript-eslint <checkout> --print <file>
//
// A line of a trace:
//
//   > Type@start-end                  a node is entered       < Type@start-end          a node is left
//   path+ s1 NODE, path- s1 NODE      onCodePathStart, onCodePathEnd
//   seg+ s1_1 NODE, seg- s1_1 NODE    onCodePathSegmentStart, onCodePathSegmentEnd
//   useg+ s1_1 NODE, useg- s1_1 NODE  onUnreachableCodePathSegmentStart, onUnreachableCodePathSegmentEnd
//   loop s1_1 s1_2 NODE               onCodePathSegmentLoop
//   graph s1 ..                       before `path-`, followed by a line for each segment
//
// The two syntax trees differ. Only the nodes that both have are entered and left in a trace: `common` says which.
// `standIn` says which node `bun lint` passes with an event where ESLint passes one that it does not have. If that
// is not in both trees either, the trace has the next node that is entered or left. Offsets are in bytes.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Case, casesFromArguments, option } from "../tokens/corpus";

const args = process.argv.slice(2);
const scratch = option(args, "--scratch") ?? ".";
const shard = option(args, "--shard");
const jobs = Number(option(args, "--jobs") ?? 16);
const ignoresNodes = args.includes("--ignore-nodes");
const eslintDirectory = option(args, "--eslint") ?? process.env.ESLINT_DIR!;
const typescriptEslintDirectory = option(args, "--typescript-eslint") ?? process.env.TYPESCRIPT_ESLINT_DIR!;

const FUNCTIONS = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);
const MEMBERS = new Set(["MethodDefinition", "PropertyDefinition", "AccessorProperty", "TSAbstractMethodDefinition", "TSAbstractPropertyDefinition", "TSAbstractAccessorProperty"]); // prettier-ignore
/** The nodes of TypeScript that are in the traces, and whose children are what they would be elsewhere. */
const TYPESCRIPT_EXPRESSIONS = new Set(["TSAsExpression", "TSTypeAssertion", "TSSatisfiesExpression", "TSNonNullExpression", "TSInstantiationExpression"]); // prettier-ignore
const ABSENT = new Set([
  "AccessorProperty", "CatchClause", "ChainExpression", "ClassBody", "Decorator", "ImportAttribute", "ImportDefaultSpecifier",
  "ImportNamespaceSpecifier", "JSXClosingElement", "JSXClosingFragment", "JSXEmptyExpression", "JSXExpressionContainer",
  "JSXIdentifier", "JSXMemberExpression", "JSXNamespacedName", "JSXOpeningElement", "JSXOpeningFragment", "JSXSpreadChild",
  "JSXText", "TemplateElement",
]); // prettier-ignore

/** The other nodes of TypeScript that have more than types in them. */
const TYPESCRIPT_CONTAINERS = new Set([
  "TSAbstractAccessorProperty", "TSAbstractMethodDefinition", "TSAbstractPropertyDefinition", "TSDeclareFunction",
  "TSEmptyBodyFunctionExpression", "TSEnumBody", "TSEnumDeclaration", "TSEnumMember", "TSExportAssignment",
  "TSExternalModuleReference", "TSImportEqualsDeclaration", "TSModuleBlock", "TSModuleDeclaration",
  "TSNamespaceExportDeclaration", "TSParameterProperty",
]); // prettier-ignore

/**
 * Whether the traces leave out `node` and everything in it, because the trees differ too much there: it only concerns
 * types, or it is a decorator of a parameter, which is inside the pattern here and before it in `bun lint`.
 */
const isTypeSyntax = (node: any) =>
  node.type === "Decorator"
    ? !/^Class|Definition$|Property$/.test(node.parent.type) || node.parent.type === "TSParameterProperty"
    : node.type.startsWith("TS") && !TYPESCRIPT_EXPRESSIONS.has(node.type) && !TYPESCRIPT_CONTAINERS.has(node.type);

/** Whether a pattern is what a declaration, a parameter or a `catch` clause binds, not the target of an assignment. */
function isBindingPattern(node: any): boolean {
  for (let child = node, parent = node.parent; parent; child = parent, parent = parent.parent) {
    switch (parent.type) {
      case "Property":
        if (parent.value !== child) return false;
        break;
      case "AssignmentPattern":
        if (parent.left !== child) return false;
        break;
      case "ArrayPattern":
      case "ObjectPattern":
      case "RestElement":
        break;
      case "AssignmentExpression":
      case "ForInStatement":
      case "ForOfStatement":
        return false;
      default:
        return true;
    }
  }
  return true;
}

/** Whether an `Identifier` or a `Literal` is an expression or, for an `Identifier`, what a pattern binds. */
function isExpressionOrBinding(node: any, sourceCode: any): boolean {
  const parent = node.parent;
  // `["a"]` and `[0]` are names in `bun lint`.
  const isPlainKey =
    (node.type === "Literal" ? typeof node.value === "string" || typeof node.value === "number" : node.type === "TemplateLiteral" && node.expressions.length === 0) &&
    sourceCode.getTokenBefore(node)?.value === "[";
  switch (parent.type) {
    case "MemberExpression":
      return parent.object === node || parent.computed;
    case "Property":
      return parent.key !== node || (parent.computed && !isPlainKey);
    case "FunctionDeclaration":
    case "FunctionExpression":
    case "ArrowFunctionExpression":
    case "ClassDeclaration":
    case "ClassExpression":
      return parent.id !== node;
    case "LabeledStatement":
    case "BreakStatement":
    case "ContinueStatement":
    case "MetaProperty":
    case "ImportSpecifier":
    case "ImportDefaultSpecifier":
    case "ImportNamespaceSpecifier":
    case "ImportAttribute":
    case "ImportDeclaration":
    case "ExportSpecifier":
    case "ExportAllDeclaration":
    case "ExportNamedDeclaration":
      return false;
    case "TSEnumMember":
      return parent.id !== node;
    case "TSParameterProperty":
    case "TSExportAssignment":
      return true;
    default:
      if (parent.params?.includes(node) || parent.parameters?.includes(node)) return true;
      if (MEMBERS.has(parent.type)) return parent.key !== node || (parent.computed && !isPlainKey);
      return !parent.type.startsWith("TS") || TYPESCRIPT_EXPRESSIONS.has(parent.type);
  }
}

/** `[type, start, end]` of a node that is in both trees. */
function common(node: any, sourceCode: any): [string, number, number] | null {
  const { type, parent } = node;
  let [start, end] = node.range;
  switch (type) {
    case "Program":
      return [type, 0, 0];
    case "Identifier":
      if (!isExpressionOrBinding(node, sourceCode)) return null;
      // typescript-estree includes the `?` and the type annotation.
      end = sourceCode.getFirstToken(node).range[1];
      break;
    case "ArrayPattern":
    case "ObjectPattern":
      if (node.typeAnnotation) end = sourceCode.getTokenBefore(node.typeAnnotation).range[1];
      break;
    case "Literal":
    case "TemplateLiteral":
      if (!isExpressionOrBinding(node, sourceCode)) return null;
      break;
    case "PrivateIdentifier":
      if (parent.type !== "BinaryExpression") return null;
      break;
    case "BlockStatement":
      if (FUNCTIONS.has(parent.type)) return null;
      break;
    case "ExportNamedDeclaration":
      if (node.declaration) return null;
      break;
    case "ExportDefaultDeclaration":
      if (/Declaration$|^TSDeclareFunction$/.test(node.declaration.type)) return null;
      break;
    case "AssignmentPattern":
    case "RestElement":
      // A parameter is a node of its own in `bun lint`, with the modifiers and the decorators.
      if (FUNCTIONS.has(parent.type) || parent.type.startsWith("TS")) return null;
      if (type === "AssignmentPattern" && parent.type === "Property" && isBindingPattern(node)) return null;
      break;
    default:
      if (ABSENT.has(type) || (type.startsWith("TS") && !TYPESCRIPT_EXPRESSIONS.has(type))) return null;
  }
  return [type, start, end];
}

/** The node that `bun lint` passes with an event for which ESLint passes `node`. */
function standIn(node: any): any {
  const parent = node.parent;
  switch (node.type) {
    case "BlockStatement":
      return FUNCTIONS.has(parent.type) ? parent : node;
    case "CatchClause":
      return node.body;
    case "ChainExpression":
      return standIn(node.expression);
    case "Identifier":
    case "PrivateIdentifier":
      if (parent.type === "MetaProperty") return parent;
      return parent.type === "MemberExpression" && parent.property === node && !parent.computed ? parent : node;
    case "AssignmentPattern":
      return parent.type === "Property" && isBindingPattern(node) ? parent : node;
    default:
      return node;
  }
}

function makeTracer() {
  const { Linter } = require(join(eslintDirectory, "lib/api.js"));
  const typescriptParser = require(join(typescriptEslintDirectory, "packages/parser/dist/index.js"));
  const linter = new Linter();
  let lines: string[] = [];

  const rule = {
    create(context: any) {
      const sourceCode = context.sourceCode;
      const text: string = sourceCode.text;
      // Where each UTF-16 code unit is in UTF-8.
      let bytes: Uint32Array | undefined;
      if (/[^\0-\x7f]/.test(text)) {
        bytes = new Uint32Array(text.length + 1);
        for (let i = 0, at = 0; i < text.length; i++) {
          const unit = text.charCodeAt(i);
          const isPair = unit >= 0xd800 && unit < 0xdc00 && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00;
          at +=
            unit < 0x80
              ? 1
              : unit < 0x800
                ? 2
                : isPair
                  ? 4
                  : unit >= 0xdc00 && unit < 0xe000 && i > 0 && (text.charCodeAt(i - 1) & 0xfc00) === 0xd800
                    ? 0
                    : 3;
          bytes[i + 1] = at;
        }
      }
      const offset = (at: number) => (bytes ? bytes[at] : at) + (sourceCode.hasBOM ? 3 : 0);
      const written = ([type, start, end]: [string, number, number]) =>
        type === "Program" ? " Program@0-0" : ` ${type}@${offset(start)}-${offset(end)}`;
      let incomplete: number[] = [];
      const segments = new Map<any, Set<any>>();
      const paths: any[] = [];

      let typeDepth = 0;
      const event = (line: string, node: any) => {
        const it = typeDepth === 0 && !isTypeSyntax(node) && common(standIn(node), sourceCode);
        if (it) line += written(it);
        else incomplete.push(lines.length);
        lines.push(line);
      };
      const visit = (prefix: string, node: any) => {
        if (isTypeSyntax(node)) return void (typeDepth += prefix === ">" ? 1 : -1);
        const it = typeDepth === 0 && common(node, sourceCode);
        if (!it) return;
        for (const at of incomplete) lines[at] += written(it);
        incomplete = [];
        lines.push(prefix + written(it));
      };
      const segment = (prefix: string) => (it: any, node: any) => {
        segments.get(paths.at(-1))!.add(it);
        event(`${prefix} ${it.id}`, node);
      };
      const list = (them: any[]) => them.map(it => it.id).join(",");
      const origins: Record<string, string> = { "program": "Program", "function": "Function", "class-field-initializer": "ClassFieldInitializer", "class-static-block": "ClassStaticBlock" }; // prettier-ignore

      return {
        "*": (node: any) => visit(">", node),
        "*:exit": (node: any) => visit("<", node),
        onCodePathStart(path: any, node: any) {
          paths.push(path);
          segments.set(path, new Set([path.initialSegment]));
          event(`path+ ${path.id}`, node);
        },
        onCodePathEnd(path: any, node: any) {
          lines.push(
            `graph ${path.id} origin=${origins[path.origin]} upper=${path.upper?.id ?? "none"} initial=${path.initialSegment.id}` +
              ` final=${list(path.finalSegments)} returned=${list(path.returnedSegments)} thrown=${list(path.thrownSegments)}`,
          );
          const found = segments.get(path)!;
          for (const it of path.finalSegments) found.add(it);
          for (const it of found) for (const other of [...it.allNextSegments, ...it.allPrevSegments]) found.add(other);
          const number = (it: any) => Number(it.id.replace(/^.*_/, ""));
          for (const it of [...found].sort((a, b) => number(a) - number(b))) {
            lines.push(
              `  ${it.id} reachable=${it.reachable} next=${list(it.nextSegments)} prev=${list(it.prevSegments)}` +
                ` allNext=${list(it.allNextSegments)} allPrev=${list(it.allPrevSegments)}`,
            );
          }
          paths.pop();
          event(`path- ${path.id}`, node);
        },
        onCodePathSegmentStart: segment("seg+"),
        onCodePathSegmentEnd: segment("seg-"),
        onUnreachableCodePathSegmentStart: segment("useg+"),
        onUnreachableCodePathSegmentEnd: segment("useg-"),
        onCodePathSegmentLoop: (from: any, to: any, node: any) => event(`loop ${from.id} ${to.id}`, node),
      };
    },
  };

  /** `null` if the parser rejects the code. */
  return (it: Case): string[] | null => {
    lines = [];
    const messages = linter.verify(
      it.code,
      {
        files: ["**"],
        plugins: { oracle: { rules: { trace: rule } } },
        rules: { "oracle/trace": 2 },
        linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "off" },
        languageOptions: {
          sourceType: it.sourceType,
          ...(it.parser === "typescript"
            ? { parser: typescriptParser, parserOptions: { ecmaFeatures: { jsx: it.jsx } } }
            : { ecmaVersion: it.ecmaVersion, parserOptions: { ecmaFeatures: { jsx: it.jsx } } }),
        },
      },
      { filename: it.path },
    );
    if (messages.some((message: any) => message.fatal)) return null;
    return lines;
  };
}

const printed = option(args, "--print");
if (printed) {
  const isJs = /\.[cm]?jsx?$/.test(printed);
  const it: Case = { id: printed, path: printed.replace(/^.*\//, ""), code: readFileSync(printed, "utf8"), parser: isJs ? "espree" : "typescript", ecmaVersion: 2026, sourceType: "module", jsx: isJs || printed.endsWith("x") }; // prettier-ignore
  console.log(makeTracer()(it)?.join("\n") ?? "the parser rejects the code");
  process.exit(0);
}

type Difference = { kind: string; id: string; context: string };
type Result = {
  cases: number;
  rejectedByOracle: number;
  rejectedByBun: number;
  wrong: number;
  events: number;
  differences: Difference[];
};

const withoutNode = (line: string) => (/^[<> ]/.test(line) ? line : line.replace(/ [A-Za-z]+@\d+-\d+$/, ""));
/** A line without what is particular to the case. */
const shape = (line?: string) =>
  line
    ?.replace(/@\d+-\d+/, "")
    .replace(/s\d+(_\d+)?/g, "s")
    .replace(/=\S*/g, "") ?? "nothing";

function compare(it: Case, expected: string[], actual: string[]): Difference | undefined {
  if (ignoresNodes) [expected, actual] = [expected.map(withoutNode), actual.map(withoutNode)];
  for (let i = 0; i < Math.max(expected.length, actual.length); i++) {
    if (expected[i] === actual[i]) continue;
    const isOnlyTheNode =
      expected[i] !== undefined && actual[i] !== undefined && withoutNode(expected[i]) === withoutNode(actual[i]);
    const around = (lines: string[]) => lines.slice(Math.max(0, i - 3), i + 2).join(" | ");
    return {
      kind: `${isOnlyTheNode ? "node of an event" : "trace"}: expected ${shape(expected[i])}, got ${shape(actual[i])}`,
      id: it.id,
      context: `${JSON.stringify(it.code.slice(0, 300))}\n      expected ${around(expected)}\n      actual   ${around(actual)}`,
    };
  }
}

function run(cases: Case[], name: string): Result {
  const trace = makeTracer();
  const result: Result = { cases: 0, rejectedByOracle: 0, rejectedByBun: 0, wrong: 0, events: 0, differences: [] };
  const accepted: { it: Case; expected: string[] }[] = [];
  for (const it of cases) {
    const expected = trace(it);
    if (expected) accepted.push({ it, expected });
    else result.rejectedByOracle++;
  }
  const input = join(scratch, `cases-${name}.jsonl`);
  writeFileSync(input, accepted.map(({ it }) => JSON.stringify({ path: it.path, code: it.code }) + "\n").join(""));
  const ran = spawnSync(option(args, "--bin")!, ["code-path", "batch", input], {
    maxBuffer: 1 << 30,
    encoding: "utf8",
  });
  const lines = ran.stdout.split("\n").filter(Boolean);
  if (lines.length !== accepted.length)
    throw new Error(`bun-lint stopped (${ran.signal ?? ran.status}) on ${input}\n${ran.stderr.slice(-2000)}`);
  accepted.forEach(({ it, expected }, i) => {
    const actual: { errors: boolean; trace: string[] } = JSON.parse(lines[i]);
    if (actual.errors) return void result.rejectedByBun++;
    result.cases++;
    result.events += expected.filter(line => !/^[<> ]/.test(line)).length;
    const difference = compare(it, expected, actual.trace);
    if (difference) {
      result.wrong++;
      result.differences.push(difference);
    }
  });
  return result;
}

let all = casesFromArguments(args);
const only = option(args, "--only");
if (only) all = all.filter(it => new RegExp(only).test(it.id));
if (shard !== undefined) {
  const mine = all.filter((_, i) => i % jobs === Number(shard));
  writeFileSync(join(scratch, `result-${shard}.json`), JSON.stringify(run(mine, shard)));
  process.exit(0);
}

mkdirSync(scratch, { recursive: true });
const children = Array.from({ length: jobs }, (_, i) =>
  Bun.spawn([process.execPath, import.meta.path, ...args, "--shard", String(i)], {
    stdout: "inherit",
    stderr: "inherit",
  }),
);
const codes = await Promise.all(children.map(child => child.exited));
if (codes.some(code => code !== 0)) process.exit(1);
const total: Result = { cases: 0, rejectedByOracle: 0, rejectedByBun: 0, wrong: 0, events: 0, differences: [] };
for (let i = 0; i < jobs; i++) {
  const part: Result = JSON.parse(readFileSync(join(scratch, `result-${i}.json`), "utf8"));
  for (const key of ["cases", "rejectedByOracle", "rejectedByBun", "wrong", "events"] as const) total[key] += part[key];
  total.differences.push(...part.differences);
}
const ranked = Map.groupBy(total.differences, it => it.kind);
const examples = Number(option(args, "--examples") ?? 2);
for (const [kind, list] of [...ranked].sort((a, b) => a[1].length - b[1].length)) {
  console.log(`${list.length} × ${kind}`);
  for (const it of list.slice(0, examples)) console.log(`    ${it.id}\n      ${it.context}`);
}
console.log(
  `${total.cases} cases compared (${total.events} events), ${total.wrong} differ. ` +
    `Not compared: ${total.rejectedByOracle} that the reference parser rejects, ${total.rejectedByBun} that only bun rejects.`,
);
