// A factory of syntax nodes: a base factory makes the common part, the factory of each kind of node stores the rest. Two kinds share one type that names no kind, and a smaller type names one of the two.
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
interface Sym { name: string }
interface Node { readonly kind: number; readonly pos: number; readonly end: number; readonly flags: number; readonly parent: Node }
interface Identifier extends Node { readonly kind: 1; readonly text: string }
interface Declaration extends Node { symbol: Sym; localSymbol?: Sym }
interface Tag extends Node { readonly parent: Node; readonly tagName: Identifier; readonly comment?: string }
interface PropertyLikeTag extends Tag, Declaration { readonly name: Identifier; readonly typeExpression?: Node; readonly isNameFirst: boolean; readonly isBracketed: boolean }
interface PropertyTag extends PropertyLikeTag { readonly kind: 2 }
interface ParameterTag extends PropertyLikeTag { readonly kind: 3 }
interface TemplateTag extends Tag { readonly kind: 4; readonly constraint: Node | undefined }
function NodeObject(this: Mutable<Node>, kind: number, pos: number, end: number) { this.pos = pos; this.end = end; this.kind = kind; this.flags = 0; this.parent = undefined!; }
const allocator = { getNodeConstructor: () => NodeObject as any as new (kind: number, pos: number, end: number) => Node };
let NodeConstructor: new (kind: number, pos: number, end: number) => Node;
const baseFactory = { createBaseNode(kind: number): Node { return new (NodeConstructor || (NodeConstructor = allocator.getNodeConstructor()))(kind, -1, -1); } };
function createBaseNode<T extends Node>(kind: T["kind"]) { return baseFactory.createBaseNode(kind) as Mutable<T>; }
function createBaseDeclaration<T extends Declaration>(kind: T["kind"]) { const node = createBaseNode(kind); node.symbol = undefined!; node.localSymbol = undefined; return node; }
function createBaseTag<T extends Tag>(kind: T["kind"], tagName: Identifier, comment: string | undefined) { const node = createBaseNode<T>(kind); node.tagName = tagName; node.comment = comment; return node; }
function createBaseTagDeclaration<T extends Tag & Declaration>(kind: T["kind"], tagName: Identifier, comment: string | undefined) { const node = createBaseDeclaration<T>(kind); node.tagName = tagName; node.comment = comment; return node; }
function createIdentifier(text: string): Identifier { const node = createBaseNode<Identifier>(1); node.text = text; return node; }
function createParameterTag(tagName: Identifier | undefined, name: Identifier, isBracketed: boolean, typeExpression?: Node, isNameFirst?: boolean, comment?: string): ParameterTag {
  const node = createBaseTagDeclaration<ParameterTag>(3, tagName ?? createIdentifier("param"), comment);
  node.typeExpression = typeExpression; node.name = name; node.isNameFirst = !!isNameFirst; node.isBracketed = isBracketed; return node;
}
function createPropertyTag(tagName: Identifier | undefined, name: Identifier, isBracketed: boolean): PropertyTag {
  const node = createBaseTagDeclaration<PropertyTag>(2, tagName ?? createIdentifier("prop"), undefined);
  node.typeExpression = undefined; node.name = name; node.isNameFirst = false; node.isBracketed = isBracketed; return node;
}
function createTemplateTag(constraint: Node | undefined): TemplateTag { const node = createBaseTag<TemplateTag>(4, createIdentifier("template"), undefined); node.constraint = constraint; return node; }
interface Named extends Node { readonly kind: 3 | 6; readonly name: Identifier }
interface Other extends Named { readonly kind: 6 }
function createBaseNamed<T extends Named>(kind: T["kind"], name: Identifier) { const node = createBaseNode<T>(kind); node.name = name; return node; }
function createOther(name: Identifier): Other { return createBaseNamed<Other>(6, name); }
function nameOf(named: Named): string { return named.kind + named.name.text; }
function describe(tag: PropertyLikeTag): string { return tag.kind + ":" + tag.tagName.text + ":" + tag.name.text + ":" + tag.isBracketed + ":" + tag.isNameFirst + ":" + (tag.comment ?? "-"); }
const tags: Tag[] = [];
for (let i = 0; i < 3; i++) {
  const p = createParameterTag(undefined, createIdentifier("x" + i), i === 1, undefined, true, "c" + i);
  const q = createPropertyTag(createIdentifier("property"), createIdentifier("y" + i), false);
  tags.push(p, q, createTemplateTag(p));
  console.log(describe(p), describe(q));
}
console.log(nameOf(createOther(createIdentifier("o"))));
console.log(tags.map(t => t.kind + t.tagName.text).join());
