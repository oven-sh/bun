// What TypeScript says the type at every node of every type-aware test case is, to compare with
// `bun-lint types dump-fixtures`.
//
//   TYPESCRIPT_ESLINT_DIR=<checkout> BUN_LINT_TYPE_ROOTS=<a,b> bun dump-types.ts <fixtures> [--rule=r] [--jobs=n] [--ts-nodes | --profiles] --out=<file>
//
// For each case: `# <rule> <index>`, then one line `[start, end, "<ESTree type>", "<type>"]` for each
// ESTree node, with offsets in UTF-8 bytes. The type is
// `checker.typeToString(services.getTypeAtLocation(node))`.
//
// With `--ts-nodes`, a line `[start, end, "<SyntaxKind>", "<type>", symbol]` for each node of
// TypeScript's own tree, where the symbol is `null` or `[name, flags, [[file, start], ..], deprecation]`.
//
// With `--profiles`, a line `[start, end, "<SyntaxKind>", { .. }]` for each expression, with what many
// functions of the checker say about its type.

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
// What `{ from: "file" }` specifiers are relative to.
process.chdir(projectDir);
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
      const lines: any[] = [];
      const at = (offset: number) => (offsets ? offsets[offset] : offset);
      const deprecationOf = (tags: import("typescript").JSDocTagInfo[]) => {
        const tag = tags.find(tag => tag.name === "deprecated");
        return tag ? ts.displayPartsToString(tag.text) : null;
      };
      if (process.argv.includes("--profiles")) {
        const sourceFile = program.getSourceFile(filePath)!;
        const text = (type: import("typescript").Type) => checker.typeToString(type);
        const optional = (type: import("typescript").Type | undefined) => (type ? text(type) : null);
        const names = (flags: number, all: Record<string, any>, wanted: string[]) => wanted.filter(name => flags & all[name]);
        const typeFlags = "Any Unknown String Number Boolean Enum BigInt StringLiteral NumberLiteral BooleanLiteral EnumLiteral BigIntLiteral ESSymbol UniqueESSymbol Void Undefined Null Never TypeParameter Object Union Intersection Index IndexedAccess Conditional Substitution NonPrimitive TemplateLiteral StringMapping".split(" ");
        const objectFlags = "Class Interface Reference Anonymous Mapped Instantiated ObjectLiteral FreshLiteral ArrayLiteral ReverseMapped ObjectRestType InstantiationExpressionType".split(" ");
        const tsutils = require("ts-api-utils");
        const typeUtils = require("@typescript-eslint/type-utils");
        const pluginUtil = (name: string) => require(`./dist/util/${name}.js`);
        const visit = (node: import("typescript").Node) => {
          ts.forEachChild(node, visit);
          if (!(ts as any).isExpressionNode(node) && !ts.isExpression(node)) return;
          if (ts.isParenthesizedExpression(node)) return;
          const profile: Record<string, unknown> = {};
          const field = (name: string, get: () => unknown) => {
            try {
              profile[name] = get();
            } catch (error) {
              profile[name] = `!${error}`;
            }
          };
          const type = checker.getTypeAtLocation(node);
          const anyType = type as any;
          field("type", () => text(type));
          field("flags", () => names(type.flags, ts.TypeFlags, typeFlags));
          field("objectFlags", () => names(type.flags & ts.TypeFlags.Object ? anyType.objectFlags : 0, ts.ObjectFlags, objectFlags));
          field("symbol", () => type.symbol?.name ?? null);
          field("aliasSymbol", () => type.aliasSymbol?.name ?? null);
          field("aliasTypeArguments", () => (type.aliasTypeArguments ?? []).map(text));
          field("types", () => (type.isUnionOrIntersection() ? type.types.map(text) : []));
          field("typeArguments", () => (tsutils.isTypeReference(type) ? checker.getTypeArguments(type).map(text) : []));
          field("isArray", () => checker.isArrayType(type));
          field("isTuple", () => checker.isTupleType(type));
          field("isArrayLike", () => checker.isArrayLikeType(type));
          field("intrinsicName", () => (type.flags & (ts.TypeFlags as any).Intrinsic ? anyType.intrinsicName : null) ?? null);
          field("apparent", () => text(checker.getApparentType(type)));
          field("baseConstraint", () => optional(checker.getBaseConstraintOfType(type)));
          field("awaited", () => optional(checker.getAwaitedType(type)));
          field("widened", () => text(checker.getWidenedType(type)));
          field("baseOfLiteral", () => text(checker.getBaseTypeOfLiteralType(type)));
          field("nonNullable", () => text(checker.getNonNullableType(type)));
          field("stringIndex", () => optional(type.getStringIndexType()));
          field("numberIndex", () => optional(type.getNumberIndexType()));
          field("properties", () => type.getProperties().slice(0, 40).map(it => it.name.replace(/^(__@\w+)@\d+$/, "$1")));
          field("propertyTypes", () => type.getProperties().slice(0, 8).map(it => text(checker.getTypeOfSymbolAtLocation(it, node))));
          field("propertyFlags", () => type.getProperties().slice(0, 8).map(it => it.flags & ~ts.SymbolFlags.Transient));
          field("call", () => type.getCallSignatures().map(it => checker.signatureToString(it)));
          field("construct", () => type.getConstructSignatures().map(it => checker.signatureToString(it)));
          field("returns", () => type.getCallSignatures().map(it => text(it.getReturnType())));
          field("parameters", () => type.getCallSignatures().map(signature => signature.parameters.map(it => [it.name, text(checker.getTypeOfSymbolAtLocation(it, node))])));
          field("baseTypes", () => (type.isClassOrInterface() ? checker.getBaseTypes(type).map(text) : []));
          field("contextual", () => optional(checker.getContextualType(node as import("typescript").Expression)));
          field("thenable", () => tsutils.isThenableType(checker, node, type));
          field("assignableToString", () => checker.isTypeAssignableTo(type, checker.getStringType()));
          const matches = (specifier: unknown) => typeUtils.typeMatchesSpecifier(type, specifier, program);
          field("isTypeAnyType", () => typeUtils.isTypeAnyType(type));
          field("isTypeUnknownType", () => typeUtils.isTypeUnknownType(type));
          field("isTypeNeverType", () => typeUtils.isTypeNeverType(type));
          field("isNullableType", () => typeUtils.isNullableType(type));
          field("isTypeArrayTypeOrUnionOfArrayTypes", () => typeUtils.isTypeArrayTypeOrUnionOfArrayTypes(type, checker));
          field("isTypeAnyArrayType", () => typeUtils.isTypeAnyArrayType(type, checker));
          field("isTypeUnknownArrayType", () => typeUtils.isTypeUnknownArrayType(type, checker));
          field("isTypeReferenceType", () => typeUtils.isTypeReferenceType(type));
          field("isTypeBrandedLiteralLike", () => typeUtils.isTypeBrandedLiteralLike(type));
          field("getTypeFlags", () => names(typeUtils.getTypeFlags(type), ts.TypeFlags, typeFlags));
          field("getTypeName", () => typeUtils.getTypeName(checker, type));
          field("isPromiseLike", () => typeUtils.isPromiseLike(program, type));
          field("isPromiseConstructorLike", () => typeUtils.isPromiseConstructorLike(program, type));
          field("isErrorLike", () => typeUtils.isErrorLike(program, type));
          field("isReadonlyErrorLike", () => typeUtils.isReadonlyErrorLike(program, type));
          field("isBuiltinSymbolLike", () => typeUtils.isBuiltinSymbolLike(program, type, ["Array", "Map", "Set", "Function", "RegExp"]));
          field("isTypeReadonly", () => typeUtils.isTypeReadonly(program, type));
          field("containsAllTypesByName", () => typeUtils.containsAllTypesByName(type, true, new Set(["Promise", "Array"]), false));
          field("containsAllTypesByNameAny", () => typeUtils.containsAllTypesByName(type, false, new Set(["Promise", "Error"]), true));
          field("discriminateAnyType", () => ["Any", "PromiseAny", "AnyArray", "Safe"][typeUtils.discriminateAnyType(type, checker, program, node)]);
          field("needsToBeAwaited", () => ["Always", "Never", "May"][pluginUtil("needsToBeAwaited").needsToBeAwaited(checker, node, type)]);
          field("getContextualType", () => optional(typeUtils.getContextualType(checker, node)));
          field("getConstrainedTypeAtLocation", () => text(checker.getBaseConstraintOfType(type) ?? type));
          field("getConstraintInfo", () => {
            const info = pluginUtil("getConstraintInfo").getConstraintInfo(checker, type);
            return [optional(info.constraintType), info.isTypeParameter];
          });
          field("isPossiblyFalsy", () => pluginUtil("truthinessUtils").isPossiblyFalsy(type));
          field("isPossiblyTruthy", () => pluginUtil("truthinessUtils").isPossiblyTruthy(type));
          field("isNumberLike", () => pluginUtil("baseTypeUtils").isNumberLike(type));
          field("isStringLike", () => pluginUtil("baseTypeUtils").isStringLike(type));
          field("hasBaseTypes", () => pluginUtil("baseTypeUtils").hasBaseTypes(type));
          field("getEnumTypes", () => require("./dist/rules/enum-utils/shared.js").getEnumTypes(checker, type).map(text));
          field("matchesLib", () => matches({ from: "lib", name: ["Promise", "Error", "Array", "string", "RegExp"] }));
          field("matchesFile", () => matches({ from: "file", name: ["Foo", "Bar", "A", "B", "T", "Test"] }));
          field("matchesFilePath", () => matches({ from: "file", name: ["Foo", "Bar", "A", "B", "T", "Test"], path: "file.ts" }));
          field("matchesPackage", () => matches({ from: "package", name: ["Buffer", "URL", "ReactNode", "Element"], package: "node:buffer" }));
          field("matchesReact", () => matches({ from: "package", name: ["ReactNode", "Element", "ReactElement", "FC"], package: "react" }));
          field("matchesName", () => matches("Foo"));
          field("isUnsafeAssignment", () => {
            const receiver = checker.getContextualType(node as import("typescript").Expression);
            if (!receiver) return null;
            const found = typeUtils.isUnsafeAssignment(type, receiver, checker, services.tsNodeToESTreeNodeMap.get(node) ?? null);
            return found ? [text(found.sender), text(found.receiver)] : false;
          });
          if (ts.isIdentifier(node)) {
            for (const [name, meaning] of [
              ["valuesInScope", ts.SymbolFlags.Value],
              ["typesInScope", ts.SymbolFlags.Type],
              ["namespacesInScope", ts.SymbolFlags.Namespace],
              ["variablesInScope", ts.SymbolFlags.BlockScopedVariable],
            ] as const) {
              field(name, () =>
                checker
                  .getSymbolsInScope(node, meaning)
                  .filter(it => it.declarations?.some(declaration => declaration.getSourceFile() === sourceFile))
                  .map(it => it.name)
                  .sort((a, b) => (Buffer.compare(Buffer.from(JSON.stringify(a)), Buffer.from(JSON.stringify(b))))),
              );
            }
          }
          if (ts.isCallExpression(node) || ts.isNewExpression(node) || ts.isTaggedTemplateExpression(node)) {
            const signature = checker.getResolvedSignature(node);
            field("resolved", () => (signature ? checker.signatureToString(signature) : null));
            field("resolvedDeclaration", () => (signature?.declaration ? ts.SyntaxKind[signature.declaration.kind] : null));
            field("resolvedDeprecation", () => (signature ? deprecationOf(signature.getJsDocTags()) : null));
            field("predicate", () => {
              const predicate = signature && checker.getTypePredicateOfSignature(signature);
              return predicate ? [ts.TypePredicateKind[predicate.kind], predicate.parameterIndex ?? -1, optional(predicate.type)] : null;
            });
          }
          lines.push([at(node.getStart(sourceFile, false)), at(node.end), ts.SyntaxKind[node.kind], profile]);
        };
        ts.forEachChild(sourceFile, visit);
      } else if (process.argv.includes("--ts-nodes")) {
        const sourceFile = program.getSourceFile(filePath)!;
        const describe = (symbol: import("typescript").Symbol) => [
          symbol.name,
          symbol.flags,
          (symbol.declarations ?? []).map(declaration => {
            const file = declaration.getSourceFile();
            const isSame = file === sourceFile;
            const start = program.isSourceFileDefaultLibrary(file) ? -1 : declaration.getStart(file, false);
            return [file.fileName.slice(file.fileName.lastIndexOf("/") + 1), isSame ? at(start) : start];
          }),
          deprecationOf(symbol.getJsDocTags(checker)),
        ];
        const visit = (node: import("typescript").Node) => {
          let type: string;
          let symbol: unknown = null;
          try {
            type = checker.typeToString(checker.getTypeAtLocation(node));
            const found = checker.getSymbolAtLocation(node);
            symbol = found ? describe(found) : null;
          } catch (error) {
            type = `!${error}`;
          }
          lines.push([at(node.getStart(sourceFile, false)), at(node.end), ts.SyntaxKind[node.kind], type, symbol]);
          ts.forEachChild(node, visit);
        };
        ts.forEachChild(sourceFile, visit);
      } else simpleTraverse(ast, {
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
