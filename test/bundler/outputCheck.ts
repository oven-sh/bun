/**
 * The check that `expectBundled` runs on every JS output, see "Output check" in `./expectBundled.md`.
 * This file loads nothing but acorn, so that a script can run the check without the test harness.
 */
import { Parser, type Pattern } from "acorn";

/**
 * The shapes of the names the bundler makes up: `exports_<file>`, `module_<file>`, `init_<file>` and
 * `export_<name>` (linker), `require_<file>`, `import_<name>`, `$<name>` and `<file>_default` (parser), and the
 * `__` runtime helpers. The renamer can add a number to each.
 */
const generatedName = /^(?:(?:exports?|module|require|init|import)_|\$[\w$]|__\w)|_default\d*$/;

/** acorn reads stage 4 syntax only, and Bun prints the stage 3 `import defer * as ns from "x"` as it is. */
const OutputParser = Parser.extend(
  Base =>
    class extends Base {
      parseImportSpecifiers(this: any) {
        if (this.value === "defer" && /^\s*\*/.test(this.input.slice(this.end))) this.next();
        return (Base.prototype as any).parseImportSpecifiers.call(this);
      }
    },
);

interface Scope {
  /** `null` in the body of a `with`, where a name can be a property of the object. */
  names: Set<string> | null;
  parent: Scope | null;
  /** The scope that a `var` in this scope declares its names in. */
  hoist: Scope;
}

/**
 * Finds the generated names that `code` uses and does not declare, each with the offset of its first use.
 * Throws the `SyntaxError` of acorn, which has a `pos`, when `code` is not JavaScript of that source type.
 *
 * A declaration anywhere in scope counts, also one that runs after the use.
 */
export function findUndeclaredGeneratedNames(code: string, sourceType: "module" | "script"): Map<string, number> {
  const program = OutputParser.parse(code, {
    ecmaVersion: "latest",
    sourceType,
    allowHashBang: true,
    // A CommonJS file can return at the top level, and a file that Bun does not bundle keeps its `import` and
    // `export` statements whatever the output format is.
    allowReturnOutsideFunction: sourceType === "script",
    allowImportExportEverywhere: sourceType === "script",
  });

  const scopeIn = (parent: Scope | null, hoists = !parent, names: Scope["names"] = new Set()): Scope => {
    const scope = { names, parent } as Scope;
    scope.hoist = hoists ? scope : parent!.hoist;
    return scope;
  };
  const bind = (pattern: Pattern | null | undefined, scope: Scope): void => {
    switch (pattern?.type) {
      case "Identifier":
        if (generatedName.test(pattern.name)) scope.names?.add(pattern.name);
        break;
      case "ObjectPattern":
        for (const property of pattern.properties) {
          bind(property.type === "Property" ? property.value : property, scope);
        }
        break;
      case "ArrayPattern":
        for (const element of pattern.elements) bind(element, scope);
        break;
      case "RestElement":
        bind(pattern.argument, scope);
        break;
      case "AssignmentPattern":
        bind(pattern.left, scope);
        break;
    }
  };

  // Uses are resolved after the walk, when every declaration is known.
  const uses: [name: string, scope: Scope, offset: number][] = [];
  const pending: [node: any, scope: Scope][] = [[program, scopeIn(null)]];
  while (pending.length) {
    let [node, scope] = pending.pop()!;
    switch (node.type) {
      case "Identifier":
        if (generatedName.test(node.name)) uses.push([node.name, scope, node.start]);
        continue;
      case "MemberExpression":
        pending.push([node.object, scope]);
        if (node.computed) pending.push([node.property, scope]);
        continue;
      case "Property":
      case "MethodDefinition":
      case "PropertyDefinition":
        if (node.computed) pending.push([node.key, scope]);
        if (node.value) pending.push([node.value, scope]);
        continue;
      case "LabeledStatement":
        pending.push([node.body, scope]);
        continue;
      case "BreakStatement":
      case "ContinueStatement":
      case "MetaProperty":
      case "ExportAllDeclaration":
        continue;
      case "ImportDeclaration":
        for (const specifier of node.specifiers) bind(specifier.local, scope);
        continue;
      case "ExportNamedDeclaration":
        if (node.source) continue;
        if (node.declaration) pending.push([node.declaration, scope]);
        for (const specifier of node.specifiers) pending.push([specifier.local, scope]);
        continue;
      case "VariableDeclaration":
        for (const declarator of node.declarations) bind(declarator.id, node.kind === "var" ? scope.hoist : scope);
        break;
      case "FunctionDeclaration":
      case "FunctionExpression":
      case "ArrowFunctionExpression":
        if (node.type === "FunctionDeclaration") {
          bind(node.id, scope);
          // Sloppy-mode code also hoists a function out of its block.
          bind(node.id, scope.hoist);
        }
        scope = scopeIn(scope, true);
        bind(node.id, scope);
        for (const param of node.params) bind(param, scope);
        break;
      case "ClassDeclaration":
      case "ClassExpression":
        if (node.type === "ClassDeclaration") bind(node.id, scope);
        scope = scopeIn(scope);
        bind(node.id, scope);
        break;
      case "CatchClause":
        scope = scopeIn(scope);
        bind(node.param, scope);
        break;
      case "BlockStatement":
      case "ForStatement":
      case "ForInStatement":
      case "ForOfStatement":
      case "SwitchStatement":
        scope = scopeIn(scope);
        break;
      case "StaticBlock":
        scope = scopeIn(scope, true);
        break;
      case "WithStatement":
        pending.push([node.object, scope], [node.body, scopeIn(scope, false, null)]);
        continue;
    }
    for (const key in node) {
      const child = node[key];
      if (Array.isArray(child)) {
        for (const item of child) if (item) pending.push([item, scope]);
      } else if (typeof child?.type === "string") {
        pending.push([child, scope]);
      }
    }
  }

  const undeclared = new Map<string, number>();
  for (const [name, from, offset] of uses) {
    let scope: Scope | null = from;
    while (scope?.names && !scope.names.has(name)) scope = scope.parent;
    if (!scope && offset < (undeclared.get(name) ?? Infinity)) undeclared.set(name, offset);
  }
  return new Map([...undeclared].sort((a, b) => a[1] - b[1]));
}
