enum SyntaxKind { Unknown, Identifier, NumericLiteral }
type Mutable<T extends object> = { -readonly [K in keyof T]: T[K] }
interface AstNode { readonly kind: SyntaxKind; readonly pos: number; readonly end: number; flags: number; getWidth?(): number; getKindName?(): string }
interface Identifier extends AstNode { readonly kind: SyntaxKind.Identifier; readonly text: string }
type NodeConstructor = new (kind: SyntaxKind, pos: number, end: number) => AstNode
function AstNode(this: Mutable<AstNode>, kind: SyntaxKind, pos: number, end: number) { this.pos = pos; this.end = end; this.kind = kind; this.flags = 0 }
function IdentifierFunction(this: Mutable<AstNode>, kind: SyntaxKind, pos: number, end: number) { this.pos = pos; this.end = end; this.kind = kind; this.flags = 2 }
class NodeObject implements AstNode {
  kind: SyntaxKind; pos: number; end: number; flags: number
  constructor(kind: SyntaxKind, pos: number, end: number) { this.flags = 8; this.kind = kind; this.pos = pos; this.end = end }
  getWidth(): number { return this.end - this.pos }
  getKindName(): string { return "class " + SyntaxKind[this.kind] }
}
class IdentifierObject extends NodeObject {
  text!: string
  override getKindName(): string { return "name " + this.text }
}
let identifierConstructor: NodeConstructor = IdentifierFunction as any
function createIdentifier(text: string, pos: number): Identifier {
  const node = new identifierConstructor(SyntaxKind.Identifier, pos, pos + text.length) as Mutable<Identifier>
  node.text = text
  return node
}
function describe(n: AstNode): string {
  return (n as any).constructor.name + "{" + Object.keys(n).join() + "}" + n.flags + "/" + (n.getWidth ? n.getWidth() : "w" + (n.end - n.pos)) + "/" + (n.getKindName?.() ?? "none")
}
const byFunction = createIdentifier("fn", 0)
console.log(describe(byFunction))
identifierConstructor = IdentifierObject
try { console.log(describe(createIdentifier("fn", 0))); console.log("instance of a class cast to a type it is not of: no error") } catch (e) { console.log("instance of a class cast to a type it is not of:", e instanceof TypeError ? "TypeError" : "other " + e) }
const plainNode: AstNode = new (AstNode as any as NodeConstructor)(SyntaxKind.Unknown, 1, 13)
AstNode.prototype.getWidth = function (this: AstNode) { return (this.end - this.pos) * 100 }
IdentifierFunction.prototype.getKindName = function (this: Identifier) { return "old name " + this.text }
function width(n: any): unknown { return n.getWidth() }
function kindName(n: any): unknown { return n.getKindName() }
console.log(describe(plainNode), describe(byFunction), width(plainNode), kindName(byFunction))
console.log("getWidth" in plainNode, "getKindName" in byFunction)
