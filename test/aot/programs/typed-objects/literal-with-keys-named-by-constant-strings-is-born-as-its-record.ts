// What the compiler makes of a literal with computed keys. Named by constant strings, they are names: the literal is born as the record of its type. Named by anything else, the literal is built key by key.
// IR= 1 born : =?L[0-9]+ = NewObject 
// IR= 0 born (Prop|Elem)Define
// IR= 0 born  = Claim 
// IR= 0 byAVariable : =?L[0-9]+ = NewObject 
// IR= 0 underProto : =?L[0-9]+ = NewObject 
declare const console: { log(...values: unknown[]): void };
const TypeId = "~scope/TypeId";
const Kind = "kind" as const;
const Proto = "__proto__";
interface Scope { readonly [TypeId]: typeof TypeId; readonly [Kind]: string; size: number }
function born(size: number): Scope { return { [TypeId]: TypeId, [Kind]: "scope", size } }
function byAVariable(key: string, size: number): Record<string, number> { return { [key]: size } }
function underProto(size: number): object { return { [Proto]: size } }
console.log(JSON.stringify(born(1)), JSON.stringify(byAVariable("a", 2)), JSON.stringify(underProto(3)));
