// A chain of generic factory helpers, each storing through `Mutable<T>`, in the style of the TypeScript compiler's node factory.
enum SyntaxKind { Identifier, StringLiteral, Parameter, Block, PropertyDeclaration, MethodDeclaration, FunctionDeclaration, ClassDeclaration, QuestionToken, ExclamationToken }
enum ModifierFlags { None = 0, Export = 1 << 0, Static = 1 << 1, Readonly = 1 << 2, Async = 1 << 3 }
type Mutable<T extends object> = { -readonly [K in keyof T]: T[K] }
interface AstNode { readonly kind: SyntaxKind; readonly pos: number; readonly end: number; transformFlags: number }
interface Token<K extends SyntaxKind> extends AstNode { readonly kind: K }
interface Identifier extends AstNode { readonly kind: SyntaxKind.Identifier; readonly text: string }
interface StringLiteral extends AstNode { readonly kind: SyntaxKind.StringLiteral; readonly text: string; readonly singleQuote?: boolean }
type PropertyName = Identifier | StringLiteral
interface Block extends AstNode { readonly kind: SyntaxKind.Block; readonly statements: readonly AstNode[] }
interface Declaration extends AstNode { symbol: object | undefined; localSymbol: object | undefined }
interface NamedDeclaration extends Declaration { readonly name?: PropertyName; readonly modifiers: ModifierFlags }
interface ParameterDeclaration extends NamedDeclaration { readonly kind: SyntaxKind.Parameter; readonly name: Identifier }
interface FunctionLikeDeclaration extends NamedDeclaration { readonly parameters: readonly ParameterDeclaration[]; readonly body?: Block; readonly typeArguments?: readonly string[] }
interface PropertyDeclaration extends NamedDeclaration { readonly kind: SyntaxKind.PropertyDeclaration; readonly name: PropertyName; readonly questionToken?: Token<SyntaxKind.QuestionToken>; readonly exclamationToken?: Token<SyntaxKind.ExclamationToken>; readonly initializer?: AstNode }
interface MethodDeclaration extends FunctionLikeDeclaration { readonly kind: SyntaxKind.MethodDeclaration; readonly name: PropertyName; readonly questionToken?: Token<SyntaxKind.QuestionToken> }
interface FunctionDeclaration extends FunctionLikeDeclaration { readonly kind: SyntaxKind.FunctionDeclaration; readonly name?: Identifier }
type ClassMember = PropertyDeclaration | MethodDeclaration
interface ClassDeclaration extends NamedDeclaration { readonly kind: SyntaxKind.ClassDeclaration; readonly name?: Identifier; readonly members: readonly ClassMember[] }

function AstNode(this: Mutable<AstNode>, kind: SyntaxKind, pos: number, end: number) { this.pos = pos; this.end = end; this.kind = kind; this.transformFlags = 0 }
const objectAllocator = { getNodeConstructor: () => AstNode as any as new (kind: SyntaxKind, pos: number, end: number) => AstNode }
function createBaseNode<T extends AstNode>(kind: T["kind"]) { return new (objectAllocator.getNodeConstructor())(kind, -1, -1) as Mutable<T> }
function createBaseDeclaration<T extends Declaration>(kind: T["kind"]) {
  const node = createBaseNode(kind) as Mutable<T>
  node.symbol = undefined
  node.localSymbol = undefined
  return node
}
function createBaseNamedDeclaration<T extends NamedDeclaration>(kind: T["kind"], modifiers: ModifierFlags, name: PropertyName | string | undefined) {
  const node = createBaseDeclaration<T>(kind), resolved = asName(name)
  node.modifiers = modifiers
  node.name = resolved
  if (resolved) node.transformFlags |= resolved.transformFlags
  if (modifiers & ModifierFlags.Async) node.transformFlags |= 32
  return node
}
function createBaseFunctionLike<T extends FunctionLikeDeclaration>(kind: T["kind"], modifiers: ModifierFlags, name: PropertyName | string | undefined, parameters: readonly ParameterDeclaration[], body: Block | undefined) {
  const node = createBaseNamedDeclaration<T>(kind, modifiers, name)
  node.parameters = parameters
  node.body = body
  for (const p of parameters) node.transformFlags |= p.transformFlags
  if (!body) node.transformFlags |= 64
  node.typeArguments = undefined
  return node
}
function finishNode<T extends AstNode>(node: Mutable<T>, pos: number, end: number): T { node.pos = pos; node.end = end; return node }
function cloneNode<T extends AstNode>(node: T): T {
  const clone = createBaseNode<T>(node.kind)
  for (const key in node) { if (Object.hasOwn(clone, key) || !Object.hasOwn(node, key)) continue; clone[key] = node[key] }
  clone.transformFlags = node.transformFlags
  return clone
}
function createToken<K extends SyntaxKind>(kind: K): Token<K> { return createBaseNode<Token<K>>(kind) }
function createIdentifier(text: string): Identifier { const node = createBaseNode<Identifier>(SyntaxKind.Identifier); node.text = text; node.transformFlags = 1; return node }
function createStringLiteral(text: string, singleQuote?: boolean): StringLiteral { const node = createBaseNode<StringLiteral>(SyntaxKind.StringLiteral); node.text = text; node.singleQuote = singleQuote; node.transformFlags = 2; return node }
function asName(name: PropertyName | string | undefined): PropertyName | undefined { return typeof name === "string" ? createIdentifier(name) : name }
function createBlock(statements: readonly AstNode[]): Block { const node = createBaseNode<Block>(SyntaxKind.Block); node.statements = statements; return node }
function createParameter(name: string): ParameterDeclaration { const node = createBaseNamedDeclaration<ParameterDeclaration>(SyntaxKind.Parameter, ModifierFlags.None, name); node.transformFlags |= 4; return node }
function createProperty(modifiers: ModifierFlags, name: PropertyName | string, mark?: Token<SyntaxKind.QuestionToken> | Token<SyntaxKind.ExclamationToken>, initializer?: AstNode): PropertyDeclaration {
  const node = createBaseNamedDeclaration<PropertyDeclaration>(SyntaxKind.PropertyDeclaration, modifiers, name)
  node.questionToken = mark && mark.kind === SyntaxKind.QuestionToken ? mark : undefined
  node.exclamationToken = mark && mark.kind === SyntaxKind.ExclamationToken ? mark : undefined
  node.initializer = initializer
  return node
}
function createMethod(modifiers: ModifierFlags, name: PropertyName | string, isOptional: boolean, parameters: readonly ParameterDeclaration[], body?: Block): MethodDeclaration {
  const node = createBaseFunctionLike<MethodDeclaration>(SyntaxKind.MethodDeclaration, modifiers, name, parameters, body)
  if (isOptional) node.questionToken = createToken(SyntaxKind.QuestionToken)
  return node
}
function createFunction(modifiers: ModifierFlags, name: string | undefined, parameters: readonly ParameterDeclaration[], body?: Block): FunctionDeclaration {
  return createBaseFunctionLike<FunctionDeclaration>(SyntaxKind.FunctionDeclaration, modifiers, name, parameters, body)
}
// T is a union here: which member the object is comes out only after the helper has returned.
function createMember(isMethod: boolean, name: string): ClassMember {
  const node = createBaseNamedDeclaration<ClassMember>(isMethod ? SyntaxKind.MethodDeclaration : SyntaxKind.PropertyDeclaration, ModifierFlags.Static, name)
  if (node.kind === SyntaxKind.MethodDeclaration) { node.parameters = []; node.body = createBlock([]) } else node.initializer = createStringLiteral(name, true)
  return node
}
function createClass(name: string | undefined, members: readonly ClassMember[]): ClassDeclaration {
  const node = createBaseNamedDeclaration<ClassDeclaration>(SyntaxKind.ClassDeclaration, ModifierFlags.Export, name)
  node.members = members
  for (const m of members) node.transformFlags |= m.transformFlags
  return node
}
function keysOf(o: object): string { return SyntaxKind[(o as AstNode).kind] + ":" + Object.keys(o).join() }
function nameOf(d: NamedDeclaration): string { return d.name ? d.name.text + (d.name.kind === SyntaxKind.StringLiteral ? "'" + d.name.singleQuote : "") : "(anonymous)" }
function arity(f: FunctionLikeDeclaration): string { return nameOf(f) + "/" + f.parameters.length + (f.body ? "{" + f.body.statements.length + "}" : ";") + f.modifiers + ("typeArguments" in f) + f.typeArguments }
function isFunctionLike(n: AstNode): n is FunctionLikeDeclaration { return n.kind === SyntaxKind.MethodDeclaration || n.kind === SyntaxKind.FunctionDeclaration }

const members = [
  createProperty(ModifierFlags.Readonly, "a", createToken(SyntaxKind.QuestionToken)), createProperty(ModifierFlags.None, createStringLiteral("b c"), createToken(SyntaxKind.ExclamationToken), createIdentifier("init")),
  createMethod(ModifierFlags.Async | ModifierFlags.Static, "m", true, [createParameter("p"), createParameter("q")], createBlock([createIdentifier("s")])), createMethod(ModifierFlags.None, createStringLiteral("n", true), false, []),
  createMember(true, "um"), createMember(false, "up"),
]
const klass = finishNode(createClass("K", members) as Mutable<ClassDeclaration>, 10, 90), anonymous = createClass(undefined, [])
const fns = [createFunction(ModifierFlags.Export, "f", [createParameter("x")], createBlock([])), createFunction(ModifierFlags.None, undefined, [])]
console.log(members.map(keysOf).join("\n"))
console.log(keysOf(klass), keysOf(anonymous), fns.map(keysOf).join(" "), keysOf(createParameter("z")), keysOf(createToken(SyntaxKind.QuestionToken)), keysOf(createStringLiteral("s")))
console.log([klass, anonymous, ...members, ...fns].map(nameOf).join(), ([...members, ...fns] as AstNode[]).filter(isFunctionLike).map(arity).join(" "), klass.pos, klass.end, anonymous.pos, klass.transformFlags, members.map(m => m.transformFlags).join())
console.log(members.map(m => (m.questionToken ? "?" : "") + ("questionToken" in m) + (m.kind === SyntaxKind.PropertyDeclaration ? (m.exclamationToken ? "!" : "") + (m.initializer ? SyntaxKind[m.initializer.kind] : "-") : "")).join(), "name" in anonymous, anonymous.name, "name" in fns[1], fns[1].symbol, "localSymbol" in fns[1])
const copies = [...members, ...fns, klass].map(n => cloneNode<NamedDeclaration>(n))
console.log(copies.map(keysOf).join("\n"))
console.log(copies.map((c, i) => c !== [...members, ...fns, klass][i] && c.name === [...members, ...fns, klass][i].name).join(), copies.map(c => c.pos + ":" + c.transformFlags + ":" + c.modifiers).join(), (copies[8] as ClassDeclaration).members === members)
let bits = 0, chars = 0
for (let i = 0; i < 8000; i++) {
  const d: NamedDeclaration = i % 4 === 0 ? createMember((i & 4) !== 0, "k" + (i & 15)) : i % 4 === 1 ? createFunction(i & 15, i & 16 ? "g" : undefined, []) : i % 4 === 2 ? createParameter("p" + i) : cloneNode(members[i % members.length])
  bits += d.transformFlags + d.modifiers; chars += nameOf(d).length + (isFunctionLike(d) ? d.parameters.length + 1 : 0)
}
console.log(bits, chars)
