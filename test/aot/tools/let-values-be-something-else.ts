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
//               neither where E is a function or class expression: the key would name it, and plain Bun reads both forms as E before it runs
//   inline      E is the one use of a `const` or `let` of the same function: it becomes the initializer, and the declaration goes
// Something else comes, and E may. E still does what it does:
//   comes=n     (never ? E : (void (E), <kinds[n]>))
//               not where the end of the program hangs on E: in what decides that a loop or an iteration has a last turn, and in what has to be called for a promise to be settled
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

type Place = {
  start: number;
  end: number;
  isShorthand: boolean;
  beginsStatement: boolean;
  takesItsName?: boolean;
  endHangsOnIt: boolean;
};
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

const passesItsValueOn = (parent: ts.Node, child: ts.Node) =>
  ts.isParenthesizedExpression(parent) ||
  ts.isAsExpression(parent) ||
  ts.isNonNullExpression(parent) ||
  ts.isSatisfiesExpression(parent) ||
  ts.isArrayLiteralExpression(parent) ||
  ts.isObjectLiteralExpression(parent) ||
  ts.isPropertyAssignment(parent) ||
  ts.isShorthandPropertyAssignment(parent) ||
  ts.isSpreadElement(parent) ||
  ts.isSpreadAssignment(parent) ||
  (ts.isConditionalExpression(parent) && parent.condition !== child) ||
  (ts.isBinaryExpression(parent) && operatorsWithAnyResult.has(parent.operatorToken.kind));
const isWrittenFunction = (node: ts.Node | undefined): node is ts.ArrowFunction | ts.FunctionExpression =>
  !!node && (ts.isArrowFunction(node) || ts.isFunctionExpression(node));
const isStep = (node: ts.Node): node is ts.PrefixUnaryExpression | ts.PostfixUnaryExpression =>
  (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
  (node.operator === K.PlusPlusToken || node.operator === K.MinusMinusToken);

/**
 * What the end of the program hangs on. With something else in its place a loop has no last turn, or nobody settles a promise that the program waits for.
 * `within`: all that is written in these. `itself`: these, but not what is written in them. `before`: all that is written from the one offset to the other.
 */
function whatTheEndHangsOn(source: ts.SourceFile) {
  const within = new Set<ts.Node>();
  const itself = new Set<ts.Node>();
  const before: [number, number][] = [];

  /** A variable by its name, a member by a dot and its name. */
  function namesIn(node: ts.Node, into: Set<string>): void {
    if (ts.isIdentifier(node)) return void into.add(node.text);
    if (ts.isPropertyAccessExpression(node)) {
      into.add("." + node.name.text);
      return namesIn(node.expression, into);
    }
    ts.forEachChild(node, child => namesIn(child, into));
  }
  function nameOfTarget(target: ts.Node): string | undefined {
    while (ts.isParenthesizedExpression(target) || ts.isNonNullExpression(target) || ts.isAsExpression(target))
      target = target.expression;
    return ts.isIdentifier(target)
      ? target.text
      : ts.isPropertyAccessExpression(target)
        ? "." + target.name.text
        : undefined;
  }
  /** `deciding`, and what is stored in `where` under a name that they read, or under a name that such a value is made of. */
  function follow(deciding: ts.Node[], where: ts.Node[]) {
    const names = new Set<string>();
    for (const node of deciding) {
      within.add(node);
      namesIn(node, names);
    }
    // Each with the tests behind which it stands.
    const stores: { name: string | undefined; parts: ts.Node[] }[] = [];
    for (const node of where)
      (function collect(node: ts.Node, tests: ts.Node[]): void {
        if (ts.isBinaryExpression(node) && isAssignment(node.operatorToken.kind))
          stores.push({ name: nameOfTarget(node.left), parts: [node.left, node.right, ...tests] });
        else if (isStep(node)) stores.push({ name: nameOfTarget(node.operand), parts: [node.operand, ...tests] });
        else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer)
          stores.push({ name: node.name.text, parts: [node.initializer, ...tests] });
        const test =
          ts.isIfStatement(node) || ts.isSwitchStatement(node)
            ? node.expression
            : ts.isConditionalExpression(node)
              ? node.condition
              : undefined;
        ts.forEachChild(node, child => collect(child, test && child !== test ? [...tests, test] : tests));
      })(node, []);
    for (let known = -1; known !== names.size; ) {
      known = names.size;
      for (const { name, parts } of stores)
        if (name !== undefined && names.has(name)) for (const part of parts) namesIn(part, names);
    }
    for (const { name, parts } of stores)
      if (name !== undefined && names.has(name)) for (const part of parts) within.add(part);
  }
  /** The tests in `body`, but not in a function that is written there, behind which it is left. */
  function testsOfWaysOut(body: ts.Node): ts.Node[] {
    const tests: ts.Node[] = [];
    const leaves = (node: ts.Node): boolean =>
      ts.isBreakStatement(node) ||
      ts.isReturnStatement(node) ||
      ts.isThrowStatement(node) ||
      (!ts.isFunctionLike(node) && !!ts.forEachChild(node, leaves));
    (function look(node: ts.Node): void {
      if (ts.isFunctionLike(node)) return;
      if ((ts.isIfStatement(node) || ts.isSwitchStatement(node)) && leaves(node)) tests.push(node.expression);
      else if (ts.isConditionalExpression(node)) tests.push(node.condition);
      ts.forEachChild(node, look);
    })(body);
    return tests;
  }
  function nameOfFunction(node: ts.Node | undefined): string | undefined {
    if (!node || !ts.isFunctionLike(node)) return undefined;
    if (node.name) return node.name.getText();
    const holder = node.parent;
    return ts.isVariableDeclaration(holder) || ts.isPropertyAssignment(holder)
      ? holder.name.getText()
      : ts.isBinaryExpression(holder) && holder.right === node
        ? nameOfTarget(holder.left)?.replace(/^\./, "")
        : undefined;
  }
  /** The calls whose answer is the answer of `node`. */
  function lastCalls(node: ts.Node): ts.CallExpression[] {
    if (ts.isCallExpression(node)) return [node];
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node))
      return lastCalls(node.expression);
    if (ts.isConditionalExpression(node)) return [...lastCalls(node.whenTrue), ...lastCalls(node.whenFalse)];
    if (ts.isBinaryExpression(node) && node.operatorToken.kind !== K.PlusToken && passesItsValueOn(node, node.right))
      return lastCalls(node.right);
    return [];
  }

  // What has to be called for a promise to be settled, by the name that holds it and by where the name holds it.
  const followed = new Set<string>();
  // `leads`: it is a function or an object of the program through which such a one is reached.
  const settling: { scope: ts.Node; name: string; leads: boolean }[] = [];
  function settles(scope: ts.Node, name: ts.Node | undefined, leads = true) {
    if (!name || !ts.isIdentifier(name) || followed.has(`${scope.pos} ${scope.end} ${name.text}`)) return;
    followed.add(`${scope.pos} ${scope.end} ${name.text}`);
    settling.push({ scope, name: name.text, leads });
  }
  const takesWhatSettles = (taker: ts.SignatureDeclaration) =>
    taker.parameters.slice(0, 2).forEach(parameter => settles(taker, parameter.name, false));
  const receiverOf = (node: ts.Node) => (isAccess(node) ? node.expression : undefined);

  const lastCallsOf = new Map<ts.Node, ts.CallExpression[]>();
  ts.forEachChild(source, function look(node): void {
    if (ts.isWhileStatement(node) || ts.isDoStatement(node) || ts.isForStatement(node)) {
      const condition = ts.isForStatement(node) ? node.condition : node.expression;
      const parts: ts.Node[] = [node.statement];
      if (ts.isForStatement(node)) for (const part of [node.initializer, node.incrementor]) if (part) parts.push(part);
      follow([...(condition ? [condition] : []), ...testsOfWaysOut(node.statement)], parts);
    }
    const around = () => functionAround(node) ?? source;
    // What an iterator answers.
    if (
      ts.isObjectLiteralExpression(node) &&
      node.properties.some(({ name }) => name && ts.isIdentifier(name) && name.text === "done")
    ) {
      follow([node], [around()]);
      for (let at: ts.Node = node; passesItsValueOn(at.parent, at); at = at.parent) itself.add(at.parent);
    }
    // Whoever asks `exec` for all matches asks until it answers null.
    if (ts.isReturnStatement(node) && node.expression && /^(next|exec)$/.test(nameOfFunction(around()) ?? ""))
      follow([node.expression], [around()]);
    // What a stream is made of.
    if (ts.isNewExpression(node) && /(Stream|Readable|Writable|Transform|Duplex)$/.test(node.expression.getText()))
      follow([...(node.arguments ?? [])], [around()]);
    const answer = ts.isReturnStatement(node) ? node.expression : ts.isArrowFunction(node) ? node.body : undefined;
    const answering = ts.isArrowFunction(node) ? node : around();
    if (answer && !ts.isBlock(answer) && lastCalls(answer).length)
      lastCallsOf.set(answering, [...(lastCallsOf.get(answering) ?? []), ...lastCalls(answer)]);
    // Who waits for an event waits for this one.
    if (ts.isCallExpression(node) && /^\.(emit|dispatchEvent|postMessage)$/.test(nameOfTarget(node.expression) ?? ""))
      follow([node.expression, ...node.arguments], []);
    // A race of nobody has no winner.
    if (ts.isCallExpression(node) && nameOfTarget(node.expression) === ".race") follow([...node.arguments], [around()]);
    const handed = ts.isNewExpression(node) || ts.isCallExpression(node) ? node.arguments?.[0] : undefined;
    if (
      (ts.isNewExpression(node) || (node as ts.CallExpression).expression?.kind === K.SuperKeyword) &&
      isWrittenFunction(handed)
    ) {
      itself.add(handed);
      takesWhatSettles(handed);
    }
    if (ts.isMethodDeclaration(node) && node.name.getText() === "then") takesWhatSettles(node);
    if (ts.isPropertyAssignment(node) && node.name.getText() === "then" && isWrittenFunction(node.initializer))
      takesWhatSettles(node.initializer);
    if (ts.isBinaryExpression(node) && nameOfTarget(node.left) === ".then" && isWrittenFunction(node.right))
      takesWhatSettles(node.right);
    if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      /\.withResolvers\(\)$/.test(node.initializer?.getText() ?? "")
    )
      for (const element of node.name.elements)
        if (/^(resolve|reject)$/.test((element.propertyName ?? element.name).getText()))
          settles(around(), element.name, false);
    ts.forEachChild(node, look);
  });

  // A function that ends in a call may be a turn of a loop: such a call leaves no frame behind.
  for (const [caller, calls] of lastCallsOf) {
    const body = (caller as ts.FunctionLikeDeclaration).body;
    if (body && testsOfWaysOut(body).length)
      follow([...testsOfWaysOut(body), ...calls.flatMap(call => [...call.arguments])], [body]);
  }

  for (let next; (next = settling.pop()); ) {
    const { scope, name, leads } = next;
    ts.forEachChild(scope, function look(node): void {
      const isRead =
        ts.isIdentifier(node) &&
        node.text === name &&
        ((node.parent as ts.NamedDeclaration).name !== node || ts.isShorthandPropertyAssignment(node.parent)) &&
        !(ts.isBindingElement(node.parent) && node.parent.propertyName === node);
      // Whether the value of `at` holds what has yet to be called.
      let holds = true;
      for (let at = node; isRead && at !== scope; at = at.parent) {
        if (holds) itself.add(at);
        const parent = at.parent;
        if (ts.isFunctionLike(parent)) {
          holds = !ts.isFunctionDeclaration(parent);
          if (ts.isFunctionDeclaration(parent)) settles(functionAround(parent) ?? source, parent.name);
        } else if (!holds || (isAccess(parent) && parent.expression === at)) continue;
        else if ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.expression === at) {
          // What throws on the way to the call is caught by nobody who would settle the promise, but in the function that is handed what settles it and in an async function.
          const caller = functionAround(parent) as ts.FunctionLikeDeclaration;
          const isAsync = ts
            .getModifiers(caller as ts.FunctionDeclaration)
            ?.some(({ kind }) => kind === K.AsyncKeyword);
          if (ts.isFunctionLike(caller) && caller.body && !isAsync && (leads || caller !== scope)) {
            const from = parent.getStart();
            before.push([caller.body.getStart(), from]);
            if (ts.isBlock(caller.body))
              follow(
                caller.body.statements.filter(statement => statement.getEnd() <= from),
                [source],
              );
          }
          if (leads || isAccess(at)) for (const argument of parent.arguments ?? []) within.add(argument);
          holds = isAccess(at);
        } else if (ts.isCallExpression(parent) || ts.isNewExpression(parent)) {
          for (const part of [parent.expression, ...(parent.arguments ?? [])])
            if (part !== at && !isWrittenFunction(part)) within.add(part);
          settles(source, receiverOf(parent.expression));
          holds = false;
        } else if (ts.isBinaryExpression(parent) && isAssignment(parent.operatorToken.kind)) {
          within.add(parent.left);
          settles(source, receiverOf(parent.left) ?? parent.left);
          holds = false;
        } else if (ts.isVariableDeclaration(parent)) {
          settles(functionAround(parent) ?? source, parent.name);
          holds = false;
        } else holds = passesItsValueOn(parent, at);
      }
      ts.forEachChild(node, look);
    });
  }
  return { within, itself, before };
}

/** Reads the file: where its values stand. */
export function read(path: string, text: string): Variants {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, scriptKindOf(path));
  const places: Place[] = [];
  const names = new Set<string>();
  const declared = new Map<string, ts.VariableDeclaration[]>();
  const used = new Map<string, { node: ts.Identifier; place: Place | undefined }[]>();
  const note = (node: ts.Identifier, place: Place | undefined) =>
    void (used.get(node.text) ?? used.set(node.text, []).get(node.text)!).push({ node, place });
  const { within, itself, before } = whatTheEndHangsOn(source);
  const isMarkedAsCommonJS = /^(#!.*\n)?\/\/ @bun\b.*@bun-cjs/.test(text);

  function visit(node: ts.Node, mayBeWrapped: boolean, endHangsOnIt: boolean) {
    if (ts.isTypeNode(node) && !ts.isExpressionWithTypeArguments(node)) return;
    endHangsOnIt ||= within.has(node) || before.some(([from, to]) => from <= node.getStart() && node.getEnd() <= to);
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
      const place = {
        start: node.name.getStart(),
        end: node.name.getEnd(),
        isShorthand: true,
        beginsStatement: false,
        endHangsOnIt: endHangsOnIt || itself.has(node.name),
      };
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
    // A first line with `@bun-cjs` says that the rest of the file is the function that the loader calls.
    if (isMarkedAsCommonJS && ts.isFunctionExpression(node) && node.parent.parent.parent === source) wraps = false;
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
          endHangsOnIt: endHangsOnIt || itself.has(node),
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
      if (!isTarget) return visit(child, true, endHangsOnIt);
      let inner = child;
      while (ts.isParenthesizedExpression(inner) || ts.isNonNullExpression(inner) || ts.isAsExpression(inner))
        inner = inner.expression;
      if (isAccess(inner))
        return ts.forEachChild(inner, part =>
          visit(part, part !== (inner as ts.PropertyAccessExpression).name, endHangsOnIt || within.has(child)),
        );
      if (ts.isVariableDeclarationList(child)) return visit(child, true, endHangsOnIt);
      // What is stored to is no use that an initializer can stand in for.
      ts.forEachChild(child, function mark(part): void {
        if (ts.isIdentifier(part)) note(part, undefined);
        ts.forEachChild(part, mark);
      });
      if (ts.isIdentifier(child)) note(child, undefined);
    });
  }
  visit(source, true, false);

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
        .filter(
          form =>
            !(place.isShorthand && form === "handed") &&
            !(place.takesItsName && (form === "field" || form === "element")),
        )
        .map(form => `${form}@${spell(place)}`),
    ),
    ...(names.length
      ? places.map((place, index) => `other@${spell(place)}=${names[(index + turn) % names.length]}`)
      : []),
    ...places.flatMap((place, index) => [
      `kind@${spell(place)}=${(index + turn) % kinds.length}`,
      ...(place.endHangsOnIt ? [] : [`comes@${spell(place)}=${(index + turn) % kinds.length}`]),
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
    else if (form === "comes" && kinds[Number(which)] && !place.endHangsOnIt)
      put(place, inner => `(${never} ? ${inner} : (void (${inner}), ${any(kinds[Number(which)])}))`);
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
