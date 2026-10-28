// An object made at the bottom of a chain of small makers, each of which casts what the one below returns; other code sees it before the casts.
// IR= 1 reference : =?L[0-9]+ = NewObject 
// IRT= 0 reference CallDirect
// IR= 1 anonymous : =?L[0-9]+ = NewObject 
interface Base { flags: number; id: number; owner?: string; symbol: string | undefined }
interface Structured extends Base { objectFlags: number; members: Map<string, number> | undefined; properties: string[] | undefined }
interface Reference extends Structured { target: Structured; typeArguments: readonly Base[] | undefined; literal?: Reference }
interface Anonymous extends Structured { target?: Anonymous; mapper?: (x: Base) => Base; instantiations?: Map<string, Base> }
interface Mapped extends Anonymous { declaration: string; nameType?: Base }
interface Parameter extends Base { constraint?: Base; target?: Parameter; isThis?: boolean }
function BaseObject(this: Base, owner: string, flags: number) { this.flags = flags; if (keepsOwner) this.owner = owner; }
const allocator = { constructorOfBase: () => BaseObject as any as new (owner: string, flags: number) => Base };
let keepsOwner = false;
let watcher: { seen(made: Base): void } | undefined;
const log: string[] = [];
function createWorld() {
  const Make = allocator.constructorOfBase();
  let count = 0;
  function create(flags: number): Base { const result = new Make("world", flags); count++; result.id = count; watcher?.seen(result); return result; }
  function createWithSymbol(flags: number, symbol: string | undefined): Base { const result = create(flags); result.symbol = symbol; return result; }
  function createStructured(objectFlags: number, symbol?: string): Structured {
    const type = createWithSymbol(32, symbol) as Structured;
    type.objectFlags = objectFlags; type.members = undefined; type.properties = undefined;
    return type;
  }
  function reference(target: Structured, typeArguments: readonly Base[] | undefined): Reference {
    const type = createStructured(4, target.symbol) as Reference;
    type.objectFlags |= typeArguments ? typeArguments.length << 8 : 0;
    type.target = target; type.typeArguments = typeArguments;
    return type;
  }
  function anonymous(from: Anonymous, mapper: (x: Base) => Base): Anonymous {
    const result = createStructured(from.objectFlags | 64, from.symbol) as Anonymous;
    if (from.objectFlags & 1) (result as Mapped).declaration = (from as Mapped).declaration;
    result.target = from; result.mapper = mapper;
    return result;
  }
  function createParameter(symbol?: string) { return createWithSymbol(2, symbol) as Parameter; }
  function parameter(from: Parameter): Parameter { const result = createParameter(from.symbol); result.target = from; return result; }
  return { createStructured, reference, anonymous, createParameter, parameter };
}
function show(value: object): string {
  return Object.keys(value).map(key => { const member = (value as any)[key]; return key + ":" + (member === null || typeof member !== "object" ? typeof member === "function" ? "function" : String(member) : Array.isArray(member) ? "[" + member.length + "]" : "{" + (member as Base).id + "}"); }).join(" ");
}
const world = createWorld();
function round(label: string) {
  const plain = world.createStructured(0, "plain");
  const made = world.reference(plain, [plain, plain]);
  const first = world.anonymous(plain as Anonymous, x => x);
  const mapped = world.createStructured(1, "mapped") as Mapped; mapped.declaration = "declared";
  const second = world.anonymous(mapped, x => plain);
  const given = world.createParameter("T");
  const copy = world.parameter(given);
  for (const value of [plain, made, first, mapped, second, given, copy]) log.push(label + " " + show(value));
  log.push(label + " " + JSON.stringify([made.target === plain, first.target === plain, second.target === mapped, (second as Mapped).declaration, second.mapper!(made).id === plain.id, copy.target === given, given.target, "target" in given, "target" in copy, "literal" in made]));
}
for (let i = 0; i < 3; i++) round("quiet" + i);
keepsOwner = true;
round("owner");
keepsOwner = false;
const kept: Base[] = [];
watcher = { seen(made) { kept.push(made); log.push("seen " + show(made)); } };
round("watched");
log.push("kept " + kept.map(show).join(" | "));
watcher = { seen(made) { (made as any).extra = made.id * 2; (made as any).symbol = "early"; } };
round("extended");
watcher = { seen(made) { (made as any).target = undefined; (made as any).objectFlags = 7; } };
round("ahead");
watcher = { seen(made) { delete (made as any).flags; } };
round("deleted");
watcher = { seen(made) { Object.defineProperty(made, "hidden", { value: 1, enumerable: false }); } };
round("hidden");
watcher = undefined;
console.log(log.join("\n"));
