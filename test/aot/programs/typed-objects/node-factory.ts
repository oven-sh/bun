// A node factory in the style of the TypeScript compiler: declarations, node arrays (arrays with extra fields), update functions, `setTextRange`, `forEachChild`, a visitor.
enum SyntaxKind { Unknown, NumericLiteral, Identifier, BinaryExpression, VariableDeclaration, Parameter, ReturnStatement, Block, FunctionDeclaration }
type Mutable<T extends object> = { -readonly [K in keyof T]: T[K] }
interface ReadonlyTextRange { readonly pos: number; readonly end: number } interface TextRange { pos: number; end: number }
interface AstNode extends ReadonlyTextRange { readonly kind: SyntaxKind; transformFlags: number; readonly original?: AstNode }
interface NodeArray<T extends AstNode> extends ReadonlyArray<T>, ReadonlyTextRange { readonly hasTrailingComma: boolean; transformFlags: number }
interface MutableNodeArray<T extends AstNode> extends Array<T>, TextRange { hasTrailingComma: boolean; transformFlags: number }
interface Expression extends AstNode { _expressionBrand: any } interface Statement extends AstNode { _statementBrand: any }
interface Declaration extends AstNode { symbol: object | undefined; localSymbol?: object }
interface NumericLiteral extends Expression { readonly kind: SyntaxKind.NumericLiteral; readonly value: number }
interface Identifier extends Expression { readonly kind: SyntaxKind.Identifier; readonly text: string }
interface BinaryExpression extends Expression { readonly kind: SyntaxKind.BinaryExpression; readonly left: Expression; readonly operator: string; readonly right: Expression }
interface VariableDeclaration extends Declaration, Statement { readonly kind: SyntaxKind.VariableDeclaration; readonly name: Identifier; readonly initializer: Expression | undefined }
interface ParameterDeclaration extends Declaration { readonly kind: SyntaxKind.Parameter; readonly name: Identifier; readonly isRest?: boolean; readonly initializer?: Expression }
interface ReturnStatement extends Statement { readonly kind: SyntaxKind.ReturnStatement; readonly expression: Expression | undefined }
interface Block extends Statement { readonly kind: SyntaxKind.Block; readonly statements: NodeArray<Statement>; readonly multiLine?: boolean }
interface FunctionDeclaration extends Declaration, Statement { readonly kind: SyntaxKind.FunctionDeclaration; readonly name: Identifier; readonly parameters: NodeArray<ParameterDeclaration>; readonly body: Block | undefined }
function AstNode(this: Mutable<AstNode>, kind: SyntaxKind, pos: number, end: number) { this.pos = pos; this.end = end; this.kind = kind; this.transformFlags = 0 }
const objectAllocator = { getNodeConstructor: () => AstNode as any as new (kind: SyntaxKind, pos: number, end: number) => AstNode }
function createBaseNode<T extends AstNode>(kind: T["kind"]) { return new (objectAllocator.getNodeConstructor())(kind, -1, -1) as Mutable<T> }
function createBaseDeclaration<T extends Declaration>(kind: T["kind"]) { const node = createBaseNode<T>(kind); node.symbol = undefined; return node }
function createNodeArray<T extends AstNode>(elements: readonly T[], hasTrailingComma = false): NodeArray<T> {
  const array = elements.slice() as MutableNodeArray<T>
  array.pos = -1; array.end = -1; array.hasTrailingComma = hasTrailingComma; array.transformFlags = 0
  for (const element of array) array.transformFlags |= element.transformFlags; return array
}
function asName(name: string | Identifier): Identifier { return typeof name === "string" ? createIdentifier(name) : name }
function createNumericLiteral(value: number) { const node = createBaseNode<NumericLiteral>(SyntaxKind.NumericLiteral); node.value = value; node.transformFlags = 1; return node }
function createIdentifier(text: string) { const node = createBaseNode<Identifier>(SyntaxKind.Identifier); node.text = text; node.transformFlags = 2; return node }
function createBinaryExpression(left: Expression, operator: string, right: Expression) {
  const node = createBaseNode<BinaryExpression>(SyntaxKind.BinaryExpression)
  node.left = left; node.operator = operator; node.right = right; node.transformFlags |= left.transformFlags | right.transformFlags | 4
  return node
}
function createVariableDeclaration(name: string | Identifier, initializer?: Expression) {
  const node = createBaseDeclaration<VariableDeclaration>(SyntaxKind.VariableDeclaration)
  node.name = asName(name); node.initializer = initializer; node.transformFlags |= node.name.transformFlags | (initializer ? initializer.transformFlags : 0) | 8
  return node
}
function createParameter(name: string | Identifier, isRest?: boolean, initializer?: Expression) {
  const node = createBaseDeclaration<ParameterDeclaration>(SyntaxKind.Parameter)
  node.name = asName(name); if (isRest) node.isRest = true
  if (initializer) { node.initializer = initializer; node.transformFlags |= initializer.transformFlags }
  return node
}
function createReturn(expression?: Expression) { const node = createBaseNode<ReturnStatement>(SyntaxKind.ReturnStatement); node.expression = expression; node.transformFlags |= expression ? expression.transformFlags : 0; return node }
function createBlock(statements: readonly Statement[] | NodeArray<Statement>, multiLine?: boolean) {
  const node = createBaseNode<Block>(SyntaxKind.Block)
  node.statements = "hasTrailingComma" in statements ? statements : createNodeArray(statements)
  if (multiLine !== undefined) node.multiLine = multiLine
  node.transformFlags |= node.statements.transformFlags; return node
}
function createFunction(name: string | Identifier, parameters: NodeArray<ParameterDeclaration>, body: Block | undefined) {
  const node = createBaseDeclaration<FunctionDeclaration>(SyntaxKind.FunctionDeclaration)
  node.name = asName(name); node.parameters = parameters; node.body = body; node.transformFlags = parameters.transformFlags | (body ? body.transformFlags : 16)
  return node
}
function setTextRange<T extends ReadonlyTextRange>(range: T, location: ReadonlyTextRange | undefined): T { if (location) { (range as TextRange).pos = location.pos; (range as TextRange).end = location.end } return range }
function setOriginalNode<T extends AstNode>(node: T, original: AstNode | undefined): T { (node as Mutable<AstNode>).original = original; return node }
function update<T extends AstNode>(updated: Mutable<T>, original: T): T { if (updated !== original) { setOriginalNode(updated, original); setTextRange(updated, original) } return updated }
type Visitor = (node: AstNode) => AstNode
function visitNodes<T extends AstNode>(nodes: NodeArray<T>, visitor: Visitor): NodeArray<T> {
  let updated: T[] | undefined
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i], visited = visitor(node) as T
    if (updated || visited !== node) { updated ||= nodes.slice(0, i); updated.push(visited) }
  }
  return updated ? setTextRange(createNodeArray(updated, nodes.hasTrailingComma), nodes) : nodes
}
function visitEachChild(node: AstNode, visitor: Visitor): AstNode {
  switch (node.kind) {
    case SyntaxKind.BinaryExpression: { const n = node as BinaryExpression, l = visitor(n.left) as Expression, r = visitor(n.right) as Expression; return n.left !== l || n.right !== r ? update(createBinaryExpression(l, n.operator, r), n) : n }
    case SyntaxKind.VariableDeclaration: { const n = node as VariableDeclaration, i = n.initializer && visitor(n.initializer) as Expression; return n.initializer !== i ? update(createVariableDeclaration(n.name, i), n) : n }
    case SyntaxKind.Parameter: { const n = node as ParameterDeclaration, i = n.initializer && visitor(n.initializer) as Expression; return n.initializer !== i ? update(createParameter(n.name, n.isRest, i), n) : n }
    case SyntaxKind.ReturnStatement: { const n = node as ReturnStatement, e = n.expression && visitor(n.expression) as Expression; return n.expression !== e ? update(createReturn(e), n) : n }
    case SyntaxKind.Block: { const n = node as Block, s = visitNodes(n.statements, visitor); return n.statements !== s ? update(createBlock(s, n.multiLine), n) : n }
    case SyntaxKind.FunctionDeclaration: { const n = node as FunctionDeclaration, p = visitNodes(n.parameters, visitor), b = n.body && visitor(n.body) as Block; return n.parameters !== p || n.body !== b ? update(createFunction(n.name, p, b), n) : n }
    default: return node
  }
}
function forEachChild(node: AstNode, cb: (child: AstNode) => void): void {
  switch (node.kind) {
    case SyntaxKind.BinaryExpression: cb((node as BinaryExpression).left); cb((node as BinaryExpression).right); break
    case SyntaxKind.VariableDeclaration: case SyntaxKind.Parameter: { const n = node as VariableDeclaration | ParameterDeclaration; cb(n.name); if (n.initializer) cb(n.initializer); break }
    case SyntaxKind.ReturnStatement: { const e = (node as ReturnStatement).expression; if (e) cb(e); break }
    case SyntaxKind.Block: (node as Block).statements.forEach(cb); break
    case SyntaxKind.FunctionDeclaration: { const n = node as FunctionDeclaration; cb(n.name); n.parameters.forEach(cb); if (n.body) cb(n.body); break }
  }
}
function emit(node: AstNode | undefined): string {
  if (!node) return ""
  switch (node.kind) {
    case SyntaxKind.NumericLiteral: return String((node as NumericLiteral).value)
    case SyntaxKind.Identifier: return (node as Identifier).text
    case SyntaxKind.BinaryExpression: { const n = node as BinaryExpression; return "(" + emit(n.left) + n.operator + emit(n.right) + ")" }
    case SyntaxKind.VariableDeclaration: { const n = node as VariableDeclaration; return "var " + emit(n.name) + (n.initializer ? "=" + emit(n.initializer) : "") }
    case SyntaxKind.Parameter: { const n = node as ParameterDeclaration; return (n.isRest ? "..." : "") + emit(n.name) + (n.initializer ? "=" + emit(n.initializer) : "") }
    case SyntaxKind.ReturnStatement: return "return " + emit((node as ReturnStatement).expression)
    case SyntaxKind.Block: { const n = node as Block; return "{" + n.statements.map(s => emit(s)).join(n.multiLine ? " ; " : ";") + "}" }
    case SyntaxKind.FunctionDeclaration: { const n = node as FunctionDeclaration; return "function " + emit(n.name) + "(" + n.parameters.map(p => emit(p)).join() + (n.parameters.hasTrailingComma ? "," : "") + ")" + emit(n.body) }
    default: return "?"
  }
}
function count(node: AstNode): number { let n = 1; forEachChild(node, child => { n += count(child) }); return n }
function keysOf(node: object): string { return Object.keys(node).join() }
const t = createIdentifier("t")
const body = setTextRange(createBlock([createVariableDeclaration(t, createBinaryExpression(createIdentifier("a"), "+", createNumericLiteral(1))), createVariableDeclaration("u"), createReturn(createBinaryExpression(t, "*", createNumericLiteral(2.5)))], true), { pos: 20, end: 60 })
const fn = setTextRange(createFunction("f", setTextRange(createNodeArray([createParameter("a"), createParameter("b", false, createNumericLiteral(7)), createParameter("rest", true)], true), { pos: 11, end: 18 }), body), { pos: 0, end: 61 })
console.log(emit(fn), count(fn), fn.transformFlags, fn.pos, fn.end, fn.parameters.pos, fn.parameters.end, fn.parameters.length, fn.parameters.transformFlags)
console.log(keysOf(fn), "|", fn.parameters.map(keysOf).join(" "), "|", keysOf(fn.parameters), "|", keysOf(body), "|", body.statements.map(keysOf).join(" "))
const doubling: Visitor = node => node.kind === SyntaxKind.NumericLiteral ? setOriginalNode(createNumericLiteral((node as NumericLiteral).value * 2), node) : visitEachChild(node, doubling)
const same = visitEachChild(fn, function keep(node): AstNode { return visitEachChild(node, keep) })
const doubled = doubling(fn) as FunctionDeclaration
console.log(same === fn, doubled === fn, emit(doubled), emit(fn), count(doubled), doubled.original === fn, doubled.pos, doubled.end, doubled.name === fn.name)
console.log(keysOf(doubled), "|", doubled.parameters.map(keysOf).join(" "), "|", keysOf(doubled.parameters), doubled.parameters.pos, doubled.parameters.hasTrailingComma)
console.log(doubled.parameters[0] === fn.parameters[0], doubled.parameters[1] === fn.parameters[1], doubled.parameters[1].original === fn.parameters[1], doubled.parameters[2].isRest, "isRest" in doubled.parameters[1], "initializer" in doubled.parameters[0])
const newBody = doubled.body, oldBody = fn.body
if (newBody && oldBody) console.log(newBody.multiLine, newBody.pos, newBody.statements[1] === oldBody.statements[1], newBody.statements[0] === oldBody.statements[0], keysOf(newBody), "original" in oldBody, oldBody.original, JSON.stringify(newBody.statements[2], (k, v) => k === "original" ? undefined : v))
console.log(emit(createFunction("g", createNodeArray<ParameterDeclaration>([]), undefined)), keysOf(createBlock([])), keysOf(createBlock([], false)), JSON.stringify(createReturn()), keysOf(createReturn()))
