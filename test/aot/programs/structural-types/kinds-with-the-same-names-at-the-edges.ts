// Expression, Throw and Return statements have the same names, so their objects may share everything but `kind`. Whatever the compiler makes of that,
// each object behaves as the plain object that the constructor function fills.
const enum Kind { Expression = 1, Throw = 2, Return = 3, Identifier = 4, Block = 5, Undeclared = 99 }
interface Node { kind: Kind; pos: number }
interface ExpressionStatement extends Node { kind: Kind.Expression; expression: Node; note?: string }
interface ThrowStatement extends Node { kind: Kind.Throw; expression: Node; note?: string }
interface ReturnStatement extends Node { kind: Kind.Return; expression: Node; note?: string }
interface Identifier extends Node { kind: Kind.Identifier; text: string }
interface Block extends Node { kind: Kind.Block; statements: Node[] }

function NodeObject(this: Node, kind: Kind, pos: number) {
  this.kind = kind;
  this.pos = pos;
}
NodeObject.prototype.describe = function (this: Node) {
  return this.kind + "@" + this.pos + ":" + Object.keys(this).join(",");
};
const NodeConstructor = NodeObject as unknown as new (kind: Kind, pos: number) => Node;
const describe = (node: Node) => (node as unknown as { describe(): string }).describe();

function identifier(text: string): Identifier {
  const node = new NodeConstructor(Kind.Identifier, 0) as Identifier;
  node.text = text;
  return node;
}
function statement(kind: Kind.Expression | Kind.Throw | Kind.Return, expression: Node) {
  const node = new NodeConstructor(kind, 1) as ExpressionStatement | ThrowStatement | ReturnStatement;
  node.expression = expression;
  return node;
}
function textOf(node: ExpressionStatement | ThrowStatement | ReturnStatement): string {
  return (node.expression as Identifier).text + "/" + node.note;
}

const name = identifier("x");
const lines: string[] = [];

// The order of the keys is the order of the stores, which differs from one object to the next.
const first = statement(Kind.Expression, name);
first.note = "late";
const second = new NodeConstructor(Kind.Throw, 2) as ThrowStatement;
second.note = "early";
second.expression = name;
const third = statement(Kind.Return, name);
lines.push(describe(first), describe(second), describe(third), textOf(first), textOf(second), textOf(third));
lines.push(String("note" in third), String(Object.hasOwn(third, "note")), JSON.stringify(third));

// A cast to a kind that the object is not: the name is absent, then stored, then deleted.
const asBlock = third as Node as Block;
lines.push(String(asBlock.statements));
asBlock.statements = [name];
lines.push(describe(third), String(asBlock.statements.length));
delete (asBlock as Partial<Block>).statements;
lines.push(describe(third), String(asBlock.statements));

// `kind` changes after the birth.
(first as Node).kind = Kind.Block;
lines.push(describe(first), String((first as Node as Block).statements), textOf(first));

// A kind that no type declares, used as a statement all the same.
const undeclared = new NodeConstructor(Kind.Undeclared, 3) as ExpressionStatement;
lines.push(describe(undeclared), String(undeclared.expression));
undeclared.expression = name;
lines.push(describe(undeclared), textOf(undeclared));

// Somebody hands in `this`.
const handedIn = { before: true } as unknown as ThrowStatement;
NodeObject.call(handedIn, Kind.Throw, 4);
handedIn.expression = name;
lines.push(Object.keys(handedIn).join(","), textOf(handedIn), String(handedIn instanceof NodeObject));

// Tags that are no integers, or integers in disguise.
for (const odd of [1.5, "1", NaN, -0, 2 ** 32 + 1, undefined, null, true, { valueOf: () => 1 }, 1n]) {
  const node = new NodeConstructor(odd as Kind, 5) as ExpressionStatement;
  node.expression = name;
  lines.push(typeof node.kind + " " + String(Object.is(node.kind, odd)) + " " + Object.keys(node).join(",") + " " + textOf(node));
}

// Many of each, through one function.
let total = 0;
for (let i = 0; i < 3000; i++) {
  const kind = i % 3 === 0 ? Kind.Expression : i % 3 === 1 ? Kind.Throw : Kind.Return;
  const node = statement(kind, i % 5 === 0 ? identifier("n" + i) : name);
  if (i % 7 === 0) node.note = "n";
  total += textOf(node).length + node.kind;
}
lines.push(String(total));
console.log(lines.join("\n"));
