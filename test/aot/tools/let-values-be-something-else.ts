// Writes a file of a program again so that one of its values may, for all that a build can tell, also be something else, or reaches the place where it is used by another road.
// What the program does stays for plain Bun to say: it runs the same text. ../programs-whose-values-may-be-something-else.ts takes the stored programs through this.
//
//   bun test/aot/tools/let-values-be-something-else.ts <file>                       lists variants of the file, one a line, each with the text it changes
//   bun test/aot/tools/let-values-be-something-else.ts <file> <variant> [<where>]   writes one, to <where> or to the standard output
//
// A variant is named <form>@<from>-<to>, the offsets of the expression E in the file, and where there is a choice =<which>. `never` is `process.argv.length > 5`: no build knows it, and it is
// false wherever nobody passes four arguments.
//
// E may be something else, and never is:
//   unknown     (never ? globalThis[process.argv[5]] : E)                 a value that nobody knows
//   handed      (never ? globalThis[process.argv[5]](E) : E)              what a function that nobody knows makes of it
//   written     (never ? (held = E, held[key] = <unknown>, held) : E)     itself, with a value that nobody knows under a key that nobody knows
//   other=name  (never ? name : E)                                        what another name at the top level of the file holds
//   kind=n      (never ? <kinds[n]> : E)                                  a number, a text, a list, an object, a Set, a Map, a function, a symbol ..
//   several@n   `unknown` in two, four or eight places at once, drawn by n
// E comes by another road:
//   variable    (held = E, held)                                          `held` is a `var` at the end of the file
//   parameter   (value => value)(E)
//   field       ({ held: E }).held
//   element     [E][0]
//   inline      E is the one use of a `const` or `let` of the same function: it becomes the initializer, and the declaration goes
// Something else comes, and E may:
//   comes=n     (never ? E : <kinds[n]>)
// The file reads less off values that nobody knows:
//   caught@0-0  the name and the message of what a `catch` has caught are taken out of `${caught}`, everywhere in the file
//               (not out of a function that was thrown: `bun run` keeps another text of it than an executable)
//
// Line breaks stay where they are, but for those of an initializer that moves.
import { readFileSync, writeFileSync } from "fs";
import ts from "typescript";

export const kinds = [
  "5",
  '"text"',
  "[]",
  "{}",
  "new Set()",
  "new Map()",
  "() => 1",
  "Symbol.iterator",
  "function () {}",
  "class {}",
  "Math.max",
  "/a/g",
  "new Date(0)",
];
export const formsOfOnePlace = ["unknown", "handed", "written", "variable", "parameter", "field", "element"] as const;
/** In these the program does what it does as it is stored. */
export const doesAsStored = (variant: string) => !/^(inline|comes|caught)\b/.test(variant);

type Place = { start: number; end: number; isShorthand: boolean; beginsStatement: boolean; takesItsName?: boolean };
type Inlining = { use: Place; initializer: [number, number]; statement: [number, number] };
type Edit = { start: number; end: number; text: string };
export type Variants = {
  path: string;
  text: string;
  isTyped: boolean;
  places: Place[];
  names: string[];
  inlinings: Inlining[];
  readsOfCaught: Edit[];
};

const K = ts.SyntaxKind;
const never = "process.argv.length > 5";
const isAssignment = (kind: ts.SyntaxKind) => kind >= K.FirstAssignment && kind <= K.LastAssignment;
const isAccess = (node: ts.Node): node is ts.PropertyAccessExpression | ts.ElementAccessExpression =>
  ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node);
// The name of a module stays a text that the build can read.
const isLoaderCall = (node: ts.Node) =>
  ts.isCallExpression(node) &&
  (node.expression.kind === K.ImportKeyword ||
    (ts.isIdentifier(node.expression) && node.expression.text === "require") ||
    (isAccess(node.expression) && /^(require|import\.meta)\b/.test(node.expression.getText())));
const neverWrapped = new Set([
  K.ParenthesizedExpression, K.SpreadElement, K.OmittedExpression, K.SuperKeyword, K.ImportKeyword, K.MetaProperty, K.PrivateIdentifier, K.ExpressionWithTypeArguments, K.TemplateHead, K.JsxExpression,
  K.NumericLiteral, K.TrueKeyword, K.FalseKeyword, K.NullKeyword, K.BigIntLiteral, K.TypeOfExpression, K.PrefixUnaryExpression, K.PostfixUnaryExpression, K.VoidExpression,
]); // prettier-ignore
const operatorsWithAnyResult = new Set([
  K.PlusToken,
  K.BarBarToken,
  K.AmpersandAmpersandToken,
  K.QuestionQuestionToken,
  K.CommaToken,
]);

function scriptKindOf(path: string) {
  if (/\.tsx$/.test(path)) return ts.ScriptKind.TSX;
  if (/\.[cm]?ts$/.test(path)) return ts.ScriptKind.TS;
  if (/\.jsx$/.test(path)) return ts.ScriptKind.JSX;
  return ts.ScriptKind.JS;
}

function beginsStatement(node: ts.Node): boolean {
  for (let at: ts.Node = node; at; at = at.parent)
    if (ts.isExpressionStatement(at))
      return (
        at.getStart() === node.getStart() &&
        (ts.isBlock(at.parent) ||
          ts.isSourceFile(at.parent) ||
          ts.isCaseOrDefaultClause(at.parent) ||
          ts.isModuleBlock(at.parent))
      );
  return false;
}

const functionAround = (node: ts.Node) =>
  ts.findAncestor(
    node.parent,
    at =>
      ts.isFunctionLike(at) ||
      ts.isClassStaticBlockDeclaration(at) ||
      ts.isPropertyDeclaration(at) ||
      ts.isSourceFile(at),
  );

/** Reads the file: where its values stand. */
export function read(path: string, text: string): Variants {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, scriptKindOf(path));
  const places: Place[] = [];
  const names = new Set<string>();
  const declared = new Map<string, ts.VariableDeclaration[]>();
  const used = new Map<string, { node: ts.Identifier; place: Place | undefined }[]>();
  const note = (node: ts.Identifier, place: Place | undefined) =>
    void (used.get(node.text) ?? used.set(node.text, []).get(node.text)!).push({ node, place });

  function visit(node: ts.Node, mayBeWrapped: boolean) {
    if (ts.isTypeNode(node) && !ts.isExpressionWithTypeArguments(node)) return;
    if (
      ts.isEnumDeclaration(node) ||
      ts.isDecorator(node) ||
      ts.isJsxElement(node) ||
      ts.isJsxSelfClosingElement(node) ||
      ts.isJsxFragment(node)
    )
      return;
    if (
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isImportDeclaration(node) ||
      ts.isExportDeclaration(node) ||
      ts.isImportEqualsDeclaration(node)
    )
      return;
    if (ts.canHaveModifiers(node) && ts.getModifiers(node)?.some(modifier => modifier.kind === K.DeclareKeyword))
      return;
    if (ts.isHeritageClause(node) && node.token !== K.ExtendsKeyword) return;
    if (ts.isShorthandPropertyAssignment(node)) {
      const place = { start: node.name.getStart(), end: node.name.getEnd(), isShorthand: true, beginsStatement: false };
      if (mayBeWrapped) places.push(place);
      return note(node.name, mayBeWrapped ? place : undefined);
    }
    const parent = node.parent;
    let wraps = mayBeWrapped && ts.isExpressionNode(node) && !neverWrapped.has(node.kind);
    if (parent) {
      // A call keeps its receiver, and `eval` and `require` keep their names.
      if (
        ts.isCallExpression(parent) &&
        parent.expression === node &&
        (isAccess(node) || (ts.isIdentifier(node) && /^(eval|require)$/.test(node.text)))
      )
        wraps = false;
      if (ts.isTaggedTemplateExpression(parent)) wraps = false;
      if (isLoaderCall(parent) && (parent as ts.CallExpression).expression !== node) wraps = false;
      if (ts.isExpressionStatement(parent) && ts.isStringLiteral(node)) wraps = false;
      if (ts.isTypeOfExpression(parent) && ts.isIdentifier(node)) wraps = false;
      if (
        parent.flags & ts.NodeFlags.OptionalChain &&
        (parent as ts.PropertyAccessExpression).expression === node &&
        node.flags & ts.NodeFlags.OptionalChain
      )
        wraps = false;
      if ((parent as ts.NamedDeclaration).name === node) wraps = false;
      if (ts.isExternalModuleReference(parent)) wraps = false;
    }
    // What `require.main` and `module.parent` answer goes by whether the text of the program names them.
    if (ts.isIdentifier(node) && /^(require|module)$/.test(node.text)) wraps = false;
    if (
      ts.isBinaryExpression(node) &&
      !isAssignment(node.operatorToken.kind) &&
      !operatorsWithAnyResult.has(node.operatorToken.kind)
    )
      wraps = false;
    const place = wraps
      ? {
          start: node.getStart(),
          end: node.getEnd(),
          isShorthand: false,
          beginsStatement: beginsStatement(node),
          takesItsName: ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isClassExpression(node),
        }
      : undefined;
    if (place) places.push(place);
    if (ts.isIdentifier(node) && !(parent && (parent as ts.NamedDeclaration).name === node)) note(node, place);

    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name))
      (declared.get(node.name.text) ?? declared.set(node.name.text, []).get(node.name.text)!).push(node);
    if (
      (ts.isVariableDeclaration(node) && node.parent.parent.parent === source) ||
      ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.parent === source)
    )
      if (node.name && ts.isIdentifier(node.name)) names.add(node.name.text);

    ts.forEachChild(node, child => {
      const isTarget =
        (ts.isBinaryExpression(node) && isAssignment(node.operatorToken.kind) && node.left === child) ||
        ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
          (node.operator === K.PlusPlusToken || node.operator === K.MinusMinusToken)) ||
        ts.isDeleteExpression(node) ||
        ((ts.isForInStatement(node) || ts.isForOfStatement(node)) && node.initializer === child);
      if (!isTarget) return visit(child, true);
      let inner = child;
      while (ts.isParenthesizedExpression(inner) || ts.isNonNullExpression(inner) || ts.isAsExpression(inner))
        inner = inner.expression;
      if (isAccess(inner))
        return ts.forEachChild(inner, part => visit(part, part !== (inner as ts.PropertyAccessExpression).name));
      if (ts.isVariableDeclarationList(child)) return visit(child, true);
      // What is stored to is no use that an initializer can stand in for.
      ts.forEachChild(child, function mark(part): void {
        if (ts.isIdentifier(part)) note(part, undefined);
        ts.forEachChild(part, mark);
      });
      if (ts.isIdentifier(child)) note(child, undefined);
    });
  }
  visit(source, true);

  const inlinings: Inlining[] = [];
  for (const [name, declarations] of declared) {
    const [declaration] = declarations;
    const uses = used.get(name) ?? [];
    const statement = declaration.parent.parent;
    if (
      declarations.length !== 1 ||
      uses.length !== 1 ||
      !uses[0].place ||
      !declaration.initializer ||
      !ts.isVariableStatement(statement)
    )
      continue;
    if (
      declaration.parent.declarations.length !== 1 ||
      !(declaration.parent.flags & ts.NodeFlags.BlockScoped) ||
      ts.getModifiers(statement)?.length
    )
      continue;
    if (functionAround(uses[0].node) !== functionAround(declaration) || uses[0].node.getStart() < statement.getEnd())
      continue;
    inlinings.push({
      use: uses[0].place,
      initializer: [declaration.initializer.getStart(), declaration.initializer.getEnd()],
      statement: [statement.getStart(), statement.getEnd()],
    });
  }

  const readsOfCaught: Edit[] = [];
  const isCaught = (node: ts.Node) =>
    ts.isIdentifier(node) &&
    !!ts.findAncestor(
      node,
      at =>
        ts.isCatchClause(at) &&
        !!at.variableDeclaration &&
        ts.isIdentifier(at.variableDeclaration.name) &&
        at.variableDeclaration.name.text === node.text,
    );
  ts.forEachChild(source, function look(node): void {
    if (
      ts.isPropertyAccessExpression(node) &&
      !(
        ts.isBinaryExpression(node.parent) &&
        isAssignment(node.parent.operatorToken.kind) &&
        node.parent.left === node
      ) &&
      !(ts.isCallExpression(node.parent) && node.parent.expression === node)
    ) {
      const holder = node.expression;
      const caught = isCaught(holder)
        ? holder
        : ts.isPropertyAccessExpression(holder) &&
            holder.name.text === "constructor" &&
            node.name.text === "name" &&
            isCaught(holder.expression)
          ? holder.expression
          : undefined;
      const taken =
        caught &&
        (node.name.text === "name"
          ? `(typeof ${caught.getText()} === "function" ? "function" : \`\${${caught.getText()}}\`.split(":", 1)[0])`
          : node.name.text === "message" && caught === holder
            ? `(typeof ${caught.getText()} === "function" ? "" : \`\${${caught.getText()}}\`.replace(/^[^:]*:? ?/, ""))`
            : undefined);
      if (taken) return void readsOfCaught.push({ start: node.getStart(), end: node.getEnd(), text: taken });
    }
    ts.forEachChild(node, look);
  });
  return { path, text, isTyped: /\.([cm]?ts|tsx)$/.test(path), places, names: [...names], inlinings, readsOfCaught };
}

const spell = ({ start, end }: Place) => `${start}-${end}`;

/**
 * The names of variants with one place: every form in every place. Where a form has a choice, a place has one of them, another for each `turn`, or a long file would have millions.
 * There are as many of `several` as anybody asks for.
 */
export function list({ places, names, inlinings, readsOfCaught }: Variants, turn = 0): string[] {
  return [
    ...places.flatMap(place =>
      formsOfOnePlace
        // Plain Bun reads `[f][0]` as `f` before it runs, and a function without a name then takes the name of the variable that it is stored in.
        .filter(form => !(place.isShorthand && form === "handed") && !(place.takesItsName && form === "element"))
        .map(form => `${form}@${spell(place)}`),
    ),
    ...(names.length
      ? places.map((place, index) => `other@${spell(place)}=${names[(index + turn) % names.length]}`)
      : []),
    ...places.flatMap((place, index) => [
      `kind@${spell(place)}=${(index + turn) % kinds.length}`,
      `comes@${spell(place)}=${(index + turn) % kinds.length}`,
    ]),
    ...inlinings.map(({ use }) => `inline@${spell(use)}`),
    ...(readsOfCaught.length ? ["caught@0-0"] : []),
  ];
}

function drawer(seed: number) {
  let state = (seed * 2654435761) >>> 0 || 1;
  return (below: number) => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state % below;
  };
}

/** The text of the variant, or undefined where the file has no such variant. */
export function write(file: Variants, variant: string): string | undefined {
  const { text, isTyped, places } = file;
  const [, form, where, which] = /^([a-z]+)@([0-9-]+)(?:=(.*))?$/.exec(variant) ?? [];
  const any = (what: string) => (isTyped ? `(${what} as any)` : what);
  const unknown = `${any("globalThis")}[process.argv[5]]`;
  const edits: Edit[] = [];
  let usesHeld = false;
  const put = (place: Place, made: (inner: string) => string) => edits.push({ start: place.start, end: place.end, text: (place.isShorthand ? `${text.slice(place.start, place.end)}: ` : place.beginsStatement ? ";" : "") + made(text.slice(place.start, place.end)) }); // prettier-ignore

  if (form === "caught") {
    if (!file.readsOfCaught.length) return undefined;
    edits.push(...file.readsOfCaught);
  } else if (form === "several") {
    if (places.length < 2) return undefined;
    const draw = drawer(Number(where));
    const size = [2, 4, 8][draw(3)];
    const chosen = new Map<string, Place>();
    for (let tries = 0; tries < size * 4 && chosen.size < size; tries++) {
      const place = places[draw(places.length)];
      if (![...chosen.values()].some(other => place.start < other.end && other.start < place.end))
        chosen.set(spell(place), place);
    }
    for (const place of chosen.values()) put(place, inner => `(${never} ? ${unknown} : ${inner})`);
  } else {
    const place = places.find(place => spell(place) === where);
    if (!place) return undefined;
    if (form === "unknown") put(place, inner => `(${never} ? ${unknown} : ${inner})`);
    else if (form === "handed") put(place, inner => `(${never} ? ${unknown}(${inner}) : ${inner})`);
    else if (form === "written")
      put(
        place,
        inner => (
          (usesHeld = true),
          `(${never} ? (held$ = ${inner}, held$[process.argv[6]] = ${unknown}, held$) : ${inner})`
        ),
      );
    else if (form === "other" && file.names.includes(which))
      put(place, inner => `(${never} ? ${any(which)} : ${inner})`);
    else if (form === "kind" && kinds[Number(which)])
      put(place, inner => `(${never} ? ${any(kinds[Number(which)])} : ${inner})`);
    else if (form === "comes" && kinds[Number(which)])
      put(place, inner => `(${never} ? ${inner} : ${any(kinds[Number(which)])})`);
    else if (form === "variable") put(place, inner => ((usesHeld = true), `(held$ = ${inner}, held$)`));
    else if (form === "parameter")
      put(place, inner => `((${isTyped ? "<T,>(value: T): T" : "value"} => value)(${inner}))`);
    else if (form === "field") put(place, inner => `(({ held: ${inner} }).held)`);
    else if (form === "element") put(place, inner => `([${inner}][0])`);
    else if (form === "inline") {
      const inlining = file.inlinings.find(({ use }) => use === place);
      if (!inlining) return undefined;
      put(place, () => `(${text.slice(...inlining.initializer)})`);
      edits.push({
        start: inlining.statement[0],
        end: inlining.statement[1],
        text: text.slice(...inlining.statement).replace(/[^\n]+/g, ""),
      });
    } else return undefined;
  }

  let [out, at] = ["", 0];
  for (const edit of edits.sort((a, b) => a.start - b.start)) {
    out += text.slice(at, edit.start) + edit.text;
    at = edit.end;
  }
  return out + text.slice(at) + (usesHeld ? `\nvar held$${isTyped ? ": any" : ""};\n` : "");
}

if (import.meta.main) {
  const [path, variant, where] = process.argv.slice(2);
  const file = read(path, readFileSync(path, "utf8"));
  if (variant === undefined) {
    for (const name of list(file)) {
      const [from, to] = /@(\d+)-(\d+)/.exec(name)!.slice(1).map(Number);
      console.log(`${name}\t${file.text.slice(from, Math.min(to, from + 60)).replace(/\s+/g, " ")}`);
    }
  } else {
    const text = write(file, variant);
    if (text === undefined) throw new Error(`${path} has no variant ${variant}`);
    if (where) writeFileSync(where, text);
    else process.stdout.write(text);
  }
}
