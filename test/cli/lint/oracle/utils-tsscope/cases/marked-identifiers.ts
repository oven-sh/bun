// Every identifier in the parameters of a signature or a setter is marked by name.
interface Recursive { m(a: Recursive): void }
type Callback = (next: Callback) => void;
const name = 1;
type Options = (opts: { name: string }) => void;
const queried = 1;
declare function query(a: typeof queried): void;
const right = 1;
declare function qualified(a: Left.right): void;
const T = 1;
declare function generic<T>(a: T): T;
const returned = 1;
type Nested = (a: (q: number) => returned) => void;
const notMarked = 1;
type Return = (a: number) => notMarked;
const key = 1;
class Setter { set x(v = { key: 1 }.key) {} }
const label = 1;
class Labels { set x(v = () => { label: for (;;) break label; }) {} }
const index = 1;
interface Index { [index: string]: number }
type IndexInParameter = (a: { [index: string]: number }) => void;
const K = 1;
type Mapped = (a: { [K in string]: K }) => void;
type InnerTypeParameter = (cb: <U>(x: number) => void) => void;
type OuterTypeParameter = <V>(x: number) => void;
const tuple = 1;
type Tuple = (a: [tuple: string]) => void;
const predicate = 1;
type Predicate = (a: (predicate: unknown) => predicate is string) => void;
const meta = 1, target = 1;
class Meta { set x(v = import.meta) {} set y(v = function () { return new.target; }) {} }
abstract class Abstract { abstract m(a: Abstract, b: { local: 1 }): void; constructor(a: number); constructor(a: any) {} }
const local = 1;
const inferred = 1;
type Infer = (a: string extends infer inferred ? 1 : 2) => void;
class Inner { set x(v = class Named { m(unusedParameter) {} }) {} }
class Decl { set x(v = () => { class InBody {} function inBody(p) {} enum E { member } interface I {} type A = 1; let z; }) {} }
const member = 1;
const obj = { set x({ a, b: [c = (d) => d] }) {}, get y() { return 1; } };
function overload(a: Overloaded): void;
function overload(a: any) {}
interface Overloaded {}
const imported = 1;
type Import = (a: import("x").imported) => void;
