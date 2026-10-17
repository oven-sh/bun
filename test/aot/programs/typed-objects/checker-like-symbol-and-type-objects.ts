// Symbol and type objects in the style of the TypeScript compiler's checker.
enum TypeFlags { Any = 1 << 0, String = 1 << 1, Number = 1 << 2, StringLiteral = 1 << 3, NumberLiteral = 1 << 4, Object = 1 << 5, Union = 1 << 6, Literal = StringLiteral | NumberLiteral, Intrinsic = Any | String | Number }
enum ObjectFlags { None = 0, Interface = 1 << 0, Anonymous = 1 << 1, PrimitiveUnion = 1 << 2 }
enum SymbolFlags { None = 0, Property = 1 << 0, Method = 1 << 1, Interface = 1 << 2, Transient = 1 << 3, Optional = 1 << 4 }
enum CheckFlags { None = 0, Readonly = 1 << 0, Late = 1 << 1 }
interface TypeChecker { typeToString(type: Ty): string; getTypeCount(): number }
interface Sym { flags: SymbolFlags; escapedName: string; declarations: string[] | undefined; id: number; mergeId: number; parent: Sym | undefined; members: Map<string, Sym> | undefined }
interface SymbolLinks { _symbolLinksBrand: any; type?: Ty; declaredType?: Ty; target?: Sym }
interface TransientSymbolLinks extends SymbolLinks { checkFlags: CheckFlags }
interface TransientSymbol extends Sym { links: TransientSymbolLinks }
interface Ty { flags: TypeFlags; id: number; checker: TypeChecker; symbol: Sym | undefined; aliasSymbol?: Sym }
interface IntrinsicType extends Ty { intrinsicName: string; debugIntrinsicName: string | undefined }
interface LiteralType extends Ty { value: string | number; freshType: LiteralType; regularType: LiteralType }
interface ObjectType extends Ty { objectFlags: ObjectFlags; members?: Map<string, Sym>; properties?: Sym[]; callSignatures?: readonly Signature[] }
interface InterfaceType extends ObjectType { typeParameters: Ty[] | undefined; thisType: Ty | undefined; resolvedBaseTypes?: ObjectType[] }
interface UnionType extends Ty { types: Ty[]; objectFlags: ObjectFlags; origin?: Ty }
interface Signature { flags: number; checker: TypeChecker; parameters: readonly Sym[]; resolvedReturnType: Ty | undefined; minArgumentCount: number }
let isDebugging = false
function Sym(this: Sym, flags: SymbolFlags, escapedName: string) {
  this.flags = flags; this.escapedName = escapedName; this.declarations = undefined; this.id = 0; this.mergeId = 0; this.parent = undefined; this.members = undefined
  ;(this as any).links = undefined
}
function Ty(this: Ty, checker: TypeChecker, flags: TypeFlags) { this.flags = flags; if (isDebugging) this.checker = checker }
function Signature(this: Signature, checker: TypeChecker, flags: number) { this.flags = flags; if (isDebugging) this.checker = checker }
const objectAllocator = {
  getSymbolConstructor: () => Sym as any as new (flags: SymbolFlags, escapedName: string) => Sym,
  getTypeConstructor: () => Ty as any as new (checker: TypeChecker, flags: TypeFlags) => Ty,
  getSignatureConstructor: () => Signature as any as new (checker: TypeChecker, flags: number) => Signature,
}
const SymbolLinksObject = class implements SymbolLinks { declare _symbolLinksBrand: any }
function createTypeChecker() {
  const SymCtor = objectAllocator.getSymbolConstructor(), TyCtor = objectAllocator.getTypeConstructor(), SignatureCtor = objectAllocator.getSignatureConstructor()
  let typeCount = 0, nextSymbolId = 1
  const symbolLinks: SymbolLinks[] = [], stringLiteralTypes = new Map<string, LiteralType>(), numberLiteralTypes = new Map<number, LiteralType>(), unionTypes = new Map<string, UnionType>()
  const checker: TypeChecker = { typeToString, getTypeCount: () => typeCount }
  function createType(flags: TypeFlags): Ty { const result = new TyCtor(checker, flags); typeCount++; result.id = typeCount; return result }
  function createTypeWithSymbol(flags: TypeFlags, symbol: Sym | undefined): Ty { const result = createType(flags); result.symbol = symbol; return result }
  function createIntrinsicType(kind: TypeFlags, intrinsicName: string, debugIntrinsicName?: string): IntrinsicType {
    const type = createType(kind) as IntrinsicType; type.intrinsicName = intrinsicName; type.debugIntrinsicName = debugIntrinsicName; return type
  }
  function createObjectType(objectFlags: ObjectFlags, symbol?: Sym): ObjectType {
    const type = createTypeWithSymbol(TypeFlags.Object, symbol) as ObjectType; type.objectFlags = objectFlags; type.members = undefined; type.properties = undefined; return type
  }
  function createLiteralType(flags: TypeFlags, value: string | number, symbol?: Sym, regularType?: LiteralType): LiteralType {
    const type = createTypeWithSymbol(flags, symbol) as LiteralType; type.value = value; type.regularType = regularType || type; return type
  }
  function getFreshTypeOfLiteralType(type: LiteralType): LiteralType {
    if (!type.freshType) { const freshType = createLiteralType(type.flags, type.value, type.symbol, type); freshType.freshType = freshType; type.freshType = freshType }
    return type.freshType
  }
  function getStringLiteralType(value: string): LiteralType { let type = stringLiteralTypes.get(value); if (!type) stringLiteralTypes.set(value, type = createLiteralType(TypeFlags.StringLiteral, value)); return type }
  function getNumberLiteralType(value: number): LiteralType { let type = numberLiteralTypes.get(value); if (!type) numberLiteralTypes.set(value, type = createLiteralType(TypeFlags.NumberLiteral, value)); return type }
  function getUnionType(types: Ty[]): Ty {
    const sorted = [...new Set(types)].sort((a, b) => a.id - b.id)
    if (sorted.length === 1) return sorted[0]
    const key = sorted.map(t => t.id).join()
    let type = unionTypes.get(key)
    if (!type) {
      type = createType(TypeFlags.Union) as UnionType
      type.objectFlags = sorted.every(t => t.flags & (TypeFlags.Literal | TypeFlags.Intrinsic)) ? ObjectFlags.PrimitiveUnion : ObjectFlags.None
      type.types = sorted; unionTypes.set(key, type)
    }
    return type
  }
  function createSymbol(flags: SymbolFlags, escapedName: string, checkFlags?: CheckFlags): TransientSymbol {
    const symbol = new SymCtor(flags | SymbolFlags.Transient, escapedName) as TransientSymbol
    symbol.links = new SymbolLinksObject() as TransientSymbolLinks; symbol.links.checkFlags = checkFlags || CheckFlags.None
    return symbol
  }
  function getSymbolLinks(symbol: Sym): SymbolLinks {
    if (symbol.flags & SymbolFlags.Transient) return (symbol as TransientSymbol).links
    return symbolLinks[symbol.id ||= nextSymbolId++] ??= new SymbolLinksObject()
  }
  function createProperty(escapedName: string, type: Ty, isTransient: boolean, isOptional = false): Sym {
    const flags = SymbolFlags.Property | (isOptional ? SymbolFlags.Optional : SymbolFlags.None)
    const symbol = isTransient ? createSymbol(flags, escapedName, CheckFlags.Late) : new SymCtor(flags, escapedName)
    getSymbolLinks(symbol).type = type; return symbol
  }
  function createSignature(parameters: readonly Sym[], returnType: Ty | undefined): Signature {
    const sig = new SignatureCtor(checker, 0)
    sig.parameters = parameters; sig.resolvedReturnType = returnType; sig.minArgumentCount = parameters.filter(p => !(p.flags & SymbolFlags.Optional)).length
    return sig
  }
  function setStructuredTypeMembers(type: ObjectType, properties: Sym[], callSignatures: readonly Signature[]): ObjectType {
    const members = type.members = new Map<string, Sym>(); type.properties = properties; type.callSignatures = callSignatures
    for (const p of properties) { members.set(p.escapedName, p); p.parent = type.symbol }
    return type
  }
  function createInterfaceType(escapedName: string, properties: Sym[], bases?: ObjectType[]): InterfaceType {
    const type = setStructuredTypeMembers(createObjectType(ObjectFlags.Interface, new SymCtor(SymbolFlags.Interface, escapedName)), properties, []) as InterfaceType
    type.typeParameters = undefined; type.thisType = createType(TypeFlags.Any); if (bases) type.resolvedBaseTypes = bases
    return type
  }
  function typeToString(type: Ty): string {
    if (type.flags & TypeFlags.Intrinsic) return (type as IntrinsicType).intrinsicName
    if (type.flags & TypeFlags.StringLiteral) return JSON.stringify((type as LiteralType).value)
    if (type.flags & TypeFlags.NumberLiteral) return String((type as LiteralType).value)
    if (type.flags & TypeFlags.Union) return (type as UnionType).types.map(typeToString).join(" | ")
    const object = type as ObjectType, calls = (object.callSignatures || []).map(s => "(" + s.parameters.map(p => p.escapedName).join() + "/" + s.minArgumentCount + "): " + (s.resolvedReturnType ? typeToString(s.resolvedReturnType) : "void"))
    const properties = (object.properties || []).map(p => p.escapedName + (p.flags & SymbolFlags.Optional ? "?" : "") + ": " + typeToString(getSymbolLinks(p).type || anyType))
    return (object.symbol ? object.symbol.escapedName + " " : "") + "{ " + [...calls, ...properties].join("; ") + " }"
  }
  const anyType = createIntrinsicType(TypeFlags.Any, "any"), stringType = createIntrinsicType(TypeFlags.String, "string"), numberType = createIntrinsicType(TypeFlags.Number, "number", "debug number")
  return { checker, anyType, stringType, numberType, getStringLiteralType, getNumberLiteralType, getFreshTypeOfLiteralType, getUnionType, createProperty, createSignature, createObjectType, setStructuredTypeMembers, createInterfaceType, getSymbolLinks }
}
function keysOf(o: object): string { return Object.keys(o).join() }
for (const debugging of [false, true]) {
  isDebugging = debugging
  const c = createTypeChecker(), a = c.getStringLiteralType("a"), two = c.getNumberLiteralType(2), fresh = c.getFreshTypeOfLiteralType(a)
  const union = c.getUnionType([two, c.stringType, a, two]) as UnionType
  const px = c.createProperty("x", c.numberType, false), py = c.createProperty("y", union, true, true)
  const call = c.createSignature([px, py], c.getUnionType([a]))
  const anonymous = c.setStructuredTypeMembers(c.createObjectType(ObjectFlags.Anonymous), [px], [call])
  const point = c.createInterfaceType("Point", [px, py, c.createProperty("self", anonymous, true)], [anonymous])
  console.log(debugging, keysOf(c.anyType), "|", keysOf(a), "|", keysOf(fresh), "|", keysOf(two), "|", keysOf(union), "|", keysOf(anonymous), "|", keysOf(point), "|", keysOf(call))
  console.log(keysOf(px), "|", keysOf(py), "|", keysOf((py as TransientSymbol).links), "|", keysOf(c.getSymbolLinks(px)), (px as any).links, px.id, py.id, (py as TransientSymbol).links.checkFlags, px.parent === point.symbol)
  console.log(c.checker.typeToString(point), "||", c.checker.typeToString(union), c.checker.getTypeCount(), union.objectFlags, point.objectFlags, point.flags, a.id, fresh.id, two.value, a.value)
  console.log(fresh.regularType === a, a.freshType === fresh, fresh.freshType === fresh, a.regularType === a, two.freshType === undefined, "freshType" in two, c.getStringLiteralType("a") === a, c.getUnionType([a, c.stringType, two]) === union)
  console.log("checker" in a, a.checker === (debugging ? c.checker : undefined), "symbol" in c.anyType, c.anyType.symbol, "symbol" in a, a.symbol, c.numberType.debugIntrinsicName, c.anyType.debugIntrinsicName, "aliasSymbol" in point, point.aliasSymbol, point.typeParameters)
}
