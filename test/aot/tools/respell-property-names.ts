// Writes a program again with every property name in one spelling. `x.name`, `x["name"]` and x[`name`] are one access, and `{ name: 1 }`, `{ "name": 1 }` and `{ ["name"]: 1 }` are one property.
//
//   bun test/aot/tools/respell-property-names.ts <spelling> [--only=<form>,..] [--names=<name>,..] <file or folder>..      rewrites the files in place
//   --list-names changes nothing and prints the names that would be respelled, with how often each stands there
//
//   names       x.name         { name: 1 }         class { name() {} }        const { name: a } = x
//   strings     x["name"]      { "name": 1 }       class { "name"() {} }      const { "name": a } = x
//   computed    x["name"]      { ["name"]: 1 }     class { ["name"]() {} }    const { ["name"]: a } = x
//   templates   x[`name`]      { [`name`]: 1 }     class { [`name`]() {} }    const { [`name`]: a } = x
//
// Line breaks stay where they are, so a line of the result is the same line of the original.
//
// Left as written, because the language tells the spellings apart or has only one of them:
//   - a name that is no identifier ("a-b"), or a whole number ("0", an element), or not ASCII
//   - private names, types, the names of decorators, JSX tags and attributes, names in `import` and `export`
//   - `constructor` in a class: `constructor() {}` and `"constructor"() {}` are the constructor, `["constructor"]() {}` is a method
//   - `__proto__` in an object literal: `__proto__: v` and `"__proto__": v` set the prototype, `["__proto__"]: v` and `{ __proto__ }` make a property
//   - the last name of `process.env.NAME`, `process.platform`, `process.arch` and `process.browser`: `bun build` puts a value there only behind a dot, unless it minifies syntax
//   - the first key of a pattern is never computed: the error for a value that cannot be taken apart names that key, unless it is computed
//   - a class member named like a modifier (`get`, `static` ..) stays quoted, `let.x` stays dotted, and a member of an enum is never declared in brackets
import { readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import ts from "typescript";

export const spellings = ["names", "strings", "computed", "templates"] as const;
export type Spelling = (typeof spellings)[number];

type Edit = { start: number; end: number; text: string };

const isPlainName = (text: string) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(text);
const modifierNames = new Set([
  "get",
  "set",
  "static",
  "async",
  "accessor",
  "declare",
  "readonly",
  "abstract",
  "override",
  "public",
  "private",
  "protected",
]);

function scriptKindOf(path: string) {
  if (/\.tsx$/.test(path)) return ts.ScriptKind.TSX;
  if (/\.[cm]?ts$/.test(path)) return ts.ScriptKind.TS;
  if (/\.jsx$/.test(path)) return ts.ScriptKind.JSX;
  return ts.ScriptKind.JS;
}

/** Where a name stands. `--only=<form>,..` respells the names of some forms alone, which shows the form that a difference comes from. */
export const forms = [
  "read", "link", "write", "compound", "call", "new", "delete", "typeof", "optional", "tag", "super", "meta", "extends", "in a key",
  "literal key", "literal method", "literal accessor", "literal shorthand", "class method", "class accessor", "class field", "static member", "pattern key", "pattern shorthand", "enum member",
] as const; // prettier-ignore
export type Form = (typeof forms)[number];

function formOfAccess(node: ts.PropertyAccessExpression | ts.ElementAccessExpression): Form {
  if (node.expression.kind === ts.SyntaxKind.SuperKeyword) return "super";
  if (ts.isMetaProperty(node.expression)) return "meta";
  if (node.flags & ts.NodeFlags.OptionalChain) return "optional";
  let child: ts.Node = node;
  let parent = node.parent;
  while (
    ts.isParenthesizedExpression(parent) ||
    ts.isNonNullExpression(parent) ||
    ts.isAsExpression(parent) ||
    ts.isSatisfiesExpression(parent)
  )
    [child, parent] = [parent, parent.parent];
  if (ts.isCallExpression(parent) && parent.expression === child) return "call";
  if (ts.isNewExpression(parent) && parent.expression === child) return "new";
  if (ts.isTaggedTemplateExpression(parent) && parent.tag === child) return "tag";
  if (ts.isDeleteExpression(parent)) return "delete";
  if (ts.isTypeOfExpression(parent)) return "typeof";
  if (
    ts.isBinaryExpression(parent) &&
    parent.left === child &&
    parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
    parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment
  )
    return parent.operatorToken.kind === ts.SyntaxKind.EqualsToken ? "write" : "compound";
  if (
    (ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) &&
    (parent.operator === ts.SyntaxKind.PlusPlusToken || parent.operator === ts.SyntaxKind.MinusMinusToken)
  )
    return "compound";
  if ((ts.isForInStatement(parent) || ts.isForOfStatement(parent)) && parent.initializer === child) return "write";
  if ((ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) && parent.expression === child)
    return "link";
  if (ts.isExpressionWithTypeArguments(parent)) return "extends";
  if (
    ts.isComputedPropertyName(parent) ||
    (ts.isElementAccessExpression(parent) && parent.argumentExpression === child)
  )
    return "in a key";
  return "read";
}

function formOfKey(owner: ts.Node): Form {
  if (ts.isBindingElement(owner)) return "pattern key";
  if (ts.isEnumMember(owner)) return "enum member";
  const isAccessor = ts.isGetAccessorDeclaration(owner) || ts.isSetAccessorDeclaration(owner);
  if (!ts.isClassLike(owner.parent))
    return isAccessor ? "literal accessor" : ts.isMethodDeclaration(owner) ? "literal method" : "literal key";
  if (
    ts.canHaveModifiers(owner) &&
    ts.getModifiers(owner)?.some(modifier => modifier.kind === ts.SyntaxKind.StaticKeyword)
  )
    return "static member";
  return isAccessor ? "class accessor" : ts.isMethodDeclaration(owner) ? "class method" : "class field";
}

/** `places`: of the names that `forms` and `names` leave, in the order of the text of one file, only those with these numbers. `found` takes where each one stands. */
export type Choice = {
  forms?: ReadonlySet<Form>;
  names?: ReadonlySet<string>;
  seen?: Map<string, number>;
  places?: ReadonlySet<number>;
  found?: number[];
};

export function respell(text: string, path: string, spelling: Spelling, choice: Choice = {}): string {
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, scriptKindOf(path));
  const edits: Edit[] = [];
  let place = 0;
  const isAsked = (form: Form, name: string, at: ts.Node) => {
    if (choice.forms && !choice.forms.has(form)) return false;
    choice.seen?.set(name, (choice.seen.get(name) ?? 0) + 1);
    if (choice.names && !choice.names.has(name)) return false;
    choice.found?.push(at.getStart(file));
    return !choice.places || choice.places.has(place++);
  };
  const quoted = (name: string) => (spelling === "templates" ? "`" + name + "`" : JSON.stringify(name));
  const asKey = (name: string, form: Spelling = spelling) =>
    form === "names" ? name : form === "strings" ? JSON.stringify(name) : `[${quoted(name)}]`;

  /** The text of a constant key: `"name"` or `name` between backticks. */
  const constantText = (node: ts.Node) =>
    ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : undefined;

  const nameOfAccess = (node: ts.Node) =>
    ts.isPropertyAccessExpression(node)
      ? ts.idText(node.name)
      : ts.isElementAccessExpression(node)
        ? constantText(node.argumentExpression)
        : undefined;
  const isProcess = (node: ts.Node) => ts.isIdentifier(node) && node.text === "process";

  /** `process.env.NODE_ENV`, `process.platform`, `process.arch`, `process.browser`: a build puts a value there only if the last name stands behind a dot. */
  const isReplacedByBuild = (node: ts.PropertyAccessExpression | ts.ElementAccessExpression, name: string) =>
    isProcess(node.expression)
      ? name === "platform" || name === "arch" || name === "browser"
      : nameOfAccess(node.expression) === "env" &&
        isProcess((node.expression as ts.PropertyAccessExpression).expression);

  function respellAccess(node: ts.PropertyAccessExpression | ts.ElementAccessExpression) {
    const name = ts.isPropertyAccessExpression(node)
      ? ts.isIdentifier(node.name)
        ? ts.idText(node.name)
        : undefined
      : constantText(node.argumentExpression);
    if (
      name === undefined ||
      !isPlainName(name) ||
      isReplacedByBuild(node, name) ||
      !isAsked(formOfAccess(node), name, node)
    )
      return;
    const afterObject = node.questionDotToken?.end ?? node.expression.end;
    const start = ts.skipTrivia(text, afterObject);
    if (ts.isPropertyAccessExpression(node)) {
      if (spelling === "names") return;
      if (ts.isIdentifier(node.expression) && node.expression.text === "let") return;
      const nameStart = node.name.getStart(file);
      // `a?.b` has no token of its own in front of the name, `a.b` has its dot.
      if (node.questionDotToken) edits.push({ start: nameStart, end: node.name.end, text: `[${quoted(name)}]` });
      else
        edits.push(
          { start, end: start + 1, text: "[" },
          { start: nameStart, end: node.name.end, text: `${quoted(name)}]` },
        );
      return;
    }
    const key = node.argumentExpression;
    if (spelling !== "names") return void edits.push({ start: key.getStart(file), end: key.end, text: quoted(name) });
    if (ts.isNumericLiteral(node.expression)) return;
    const between = text.slice(start + 1, key.getStart(file)) + text.slice(key.end, node.end - 1);
    if (between.trim() !== "") return;
    edits.push({
      start,
      end: node.end,
      text: (node.questionDotToken ? "" : ".") + name + between.replace(/[^\n]/g, ""),
    });
  }

  function isAssignedTo(node: ts.Node): boolean {
    const parent = node.parent;
    if (ts.isBinaryExpression(parent))
      return parent.operatorToken.kind === ts.SyntaxKind.EqualsToken && parent.left === node;
    if (ts.isForInStatement(parent) || ts.isForOfStatement(parent)) return parent.initializer === node;
    if (ts.isPropertyAssignment(parent)) return parent.initializer === node && isAssignedTo(parent.parent);
    return (
      (ts.isParenthesizedExpression(parent) ||
        ts.isArrayLiteralExpression(parent) ||
        ts.isSpreadElement(parent) ||
        ts.isSpreadAssignment(parent)) &&
      isAssignedTo(parent)
    );
  }

  /** The error for `const { a } = null` names `a`, the one for `const { ["a"]: a } = null` names nothing. */
  const isFirstOfPattern = (owner: ts.Node) =>
    ts.isBindingElement(owner)
      ? owner.parent.elements[0] === owner
      : ts.isObjectLiteralExpression(owner.parent) &&
        owner.parent.properties[0] === owner &&
        isAssignedTo(owner.parent);

  function respellKey(key: ts.PropertyName, owner: ts.Node) {
    const isComputed = ts.isComputedPropertyName(key);
    const name = ts.isIdentifier(key) ? ts.idText(key) : isComputed ? constantText(key.expression) : constantText(key);
    if (name === undefined || !isPlainName(name) || !isAsked(formOfKey(owner), name, key)) return;
    let form = spelling;
    if (ts.isClassLike(owner.parent)) {
      if (name === "constructor") return;
      if (form === "names" && modifierNames.has(name)) form = "strings";
    }
    if ((ts.isEnumMember(owner) || isFirstOfPattern(owner)) && form !== "names") form = "strings";
    if (name === "__proto__" && ts.isPropertyAssignment(owner)) {
      if (isComputed) form = form === "templates" ? "templates" : "computed";
      else if (form === "computed" || form === "templates") form = "strings";
    }
    edits.push({ start: key.getStart(file), end: key.end, text: asKey(name, form) });
  }

  /** `{ a }` and `{ a = 1 }`, in a literal and in a pattern: the name is key and variable at once. */
  function respellShorthand(name: ts.Identifier) {
    const text = ts.idText(name);
    if (
      spelling === "names" ||
      !isPlainName(text) ||
      !isAsked(ts.isBindingElement(name.parent) ? "pattern shorthand" : "literal shorthand", text, name)
    )
      return;
    const form = isFirstOfPattern(name.parent)
      ? "strings"
      : text === "__proto__" && spelling === "strings"
        ? "computed"
        : spelling;
    edits.push({ start: name.getStart(file), end: name.getStart(file), text: `${asKey(text, form)}: ` });
  }

  /** `a.b.c` and `a.b.c(..)` where only dotted names are allowed: what is passed to a call is visited, the names are not. */
  function visitDottedName(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      visitDottedName(node.expression);
      node.arguments.forEach(visit);
    } else if (ts.isPropertyAccessExpression(node)) visitDottedName(node.expression);
    else if (!ts.isIdentifier(node)) visit(node);
  }

  function visit(node: ts.Node) {
    if (ts.isTypeNode(node) && !ts.isExpressionWithTypeArguments(node)) return;
    if (
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isImportDeclaration(node) ||
      ts.isExportDeclaration(node) ||
      ts.isImportEqualsDeclaration(node)
    )
      return;
    if (
      ts.canHaveModifiers(node) &&
      ts.getModifiers(node)?.some(modifier => modifier.kind === ts.SyntaxKind.DeclareKeyword) &&
      !ts.isPropertyDeclaration(node)
    )
      return;
    if (
      ts.isHeritageClause(node) &&
      (node.token === ts.SyntaxKind.ImplementsKeyword || ts.isInterfaceDeclaration(node.parent))
    )
      return;
    if (ts.isDecorator(node)) return visitDottedName(node.expression);
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) return void visit(node.attributes);
    if (ts.isJsxClosingElement(node)) return;

    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) respellAccess(node);
    else if (ts.isShorthandPropertyAssignment(node)) respellShorthand(node.name);
    else if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
      if (node.propertyName) respellKey(node.propertyName, node);
      else if (!node.dotDotDotToken && ts.isIdentifier(node.name)) respellShorthand(node.name);
    } else if (
      ts.isPropertyAssignment(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node) ||
      ts.isPropertyDeclaration(node) ||
      ts.isEnumMember(node)
    )
      respellKey(node.name, node);
    ts.forEachChild(node, visit);
  }
  visit(file);

  edits.sort((a, b) => a.start - b.start || a.end - b.end);
  let result = "";
  let at = 0;
  for (const edit of edits) {
    result += text.slice(at, edit.start) + edit.text;
    at = edit.end;
  }
  return result + text.slice(at);
}

const isProgramText = (name: string) => /\.([cm]?[jt]s|[jt]sx)$/.test(name) && !/\.d\.[cm]?ts$/.test(name);

export function respellFiles(path: string, spelling: Spelling, choice: Choice = {}): number {
  if (statSync(path).isDirectory())
    return readdirSync(path).reduce((count, name) => count + respellFiles(join(path, name), spelling, choice), 0);
  if (!isProgramText(path)) return 0;
  const before = readFileSync(path, "utf8");
  const after = respell(before, path, spelling, choice);
  if (after !== before) writeFileSync(path, after);
  return 1;
}

if (import.meta.main) {
  const [spelling, ...rest] = process.argv.slice(2);
  const within = rest.find(argument => argument.startsWith("--in="))?.slice(5);
  const paths = rest.filter(
    argument => !argument.startsWith("--") && (within === undefined || argument.endsWith(within)),
  );
  if (within !== undefined && paths.length === 0) process.exit(0);
  const listed = (flag: string) =>
    rest.filter(argument => argument.startsWith(flag)).flatMap(argument => argument.slice(flag.length).split(","));
  const asked = listed("--only=") as Form[];
  const names = listed("--names=");
  const seen = rest.includes("--list-names") ? new Map<string, number>() : undefined;
  const places = listed("--places=").map(Number);
  if (rest.includes("--list-places")) {
    for (const path of paths) {
      const found: number[] = [];
      const text = readFileSync(path, "utf8");
      respell(text, path, spelling as Spelling, {
        forms: asked.length ? new Set(asked) : undefined,
        names: names.length ? new Set(names) : undefined,
        places: new Set(),
        found,
      });
      for (const [index, at] of found.entries())
        console.log(
          `${path}\t${index}\t${text.slice(0, at).split("\n").length}\t${text
            .slice(text.lastIndexOf("\n", at) + 1, (text.indexOf("\n", at) + 1 || text.length + 1) - 1)
            .trim()
            .slice(0, 160)}`,
        );
    }
    process.exit(0);
  }
  if (!spellings.includes(spelling as Spelling) || paths.length === 0 || asked.some(form => !forms.includes(form))) {
    console.error(
      `usage: respell-property-names.ts <${spellings.join(" | ")}> [--only=<${forms.join(" | ")}>,..] <file or folder>..`,
    );
    process.exit(2);
  }
  let count = 0;
  const choice = {
    forms: asked.length ? new Set(asked) : undefined,
    names: seen ? new Set<string>() : names.length ? new Set(names) : undefined,
    seen,
    places: places.length ? new Set(places) : undefined,
  };
  for (const path of paths) count += respellFiles(path, spelling as Spelling, choice);
  if (seen) for (const [name, times] of seen) console.log(`${times}\t${name}`);
  else console.log(`${count} files`);
}
