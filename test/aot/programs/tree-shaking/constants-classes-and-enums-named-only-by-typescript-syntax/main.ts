// Each declaration has one reference, and it is written in a form that only TypeScript has: `import a = N.b`, `export import`, `export =` in another file, a namespace that closes over it, a parameter property's default, `satisfies`, `as const`, a non-null mark, an angle-bracket cast, an instantiation expression, an enum initializer, an abstract class's heritage, an accessor's initializer. `bun run` does not get as far as running it (SyntaxError: import call expects one or two arguments), so `bun build --compile` is the reference.
import assigned = require("./assigned");

const closedOver = "closed over by a namespace";
namespace Closes { export const value = closedOver; }
const inNested = "closed over two namespaces deep";
namespace Outer { export namespace Inner { export function read() { return inNested; } } }
namespace Holder { export const held = { text: "aliased out of a namespace" }; export enum Kind { A = "an enum aliased out of a namespace" } }
import held = Holder.held;
import Kind = Holder.Kind;
enum Aliased { Member = "an enum under an alias" }
import Alias = Aliased;
const asDefault = "the default of a parameter property";
class WithProperty { constructor(public value = asDefault) {} }
const satisfied = { text: "satisfies" };
const constant = ["as const"];
const nonNull: string | undefined = "non-null";
const angled = "an angle-bracket cast";
const generic = <T,>(value: T) => value;
const length = 5;
enum Computed { Size = length * 2 }
abstract class Abstract { hello() { return "an abstract base"; } }
class Concrete extends Abstract {}
const forAccessor = "the initializer of an accessor";
class WithAccessor { accessor value = forAccessor; }
const forOptional = { deep: { text: "an optional chain" } };
const forDefinite = "a definite assignment";
let definite!: string;
definite = forDefinite;

const instantiated = generic<string>;
console.log(Closes.value, Outer.Inner.read(), held.text, Kind.A, Alias.Member, new WithProperty().value);
console.log((satisfied satisfies object).text, (constant as readonly string[])[0], nonNull!, <string>angled, instantiated("an instantiation expression"), Computed.Size);
console.log(new Concrete().hello(), new WithAccessor().value, forOptional?.deep?.text, definite, assigned.text, assigned.list[0]);
