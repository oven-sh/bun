// `{ ...typed, property }`: the copy is a new object, and a property that comes after the spread has its own type, whatever the spread brought under that name.
// Where nothing written says what the copy is, a property of type any is not held to the type the spread's source declares for it.
// IR= 0 withAny CloneAs 
// IR= 1 declared CloneAs 
// IR= 1 withCount CloneAs 
interface Field { kind: string }
interface Entries { key1: Field; key2: Field }
interface Schema { type: "object"; entries: Entries; count: number }
const made: Schema = { type: "object", entries: { key1: { kind: "string" }, key2: { kind: "number" } }, count: 1 };
const withNumber = (schema: Schema, entries: number) => ({ ...schema, entries });
console.log(withNumber(made, 5).entries + 1);
const withFewer = (schema: Schema, entries: { key2: Field }) => ({ ...schema, entries });
console.log(Object.keys(withFewer(made, { key2: { kind: "number" } }).entries).join());
const withText = (schema: Schema, count: string) => ({ ...schema, count });
console.log(withText(made, "many").count.toUpperCase());
const withUnknown = (schema: Schema, entries: unknown) => ({ ...schema, entries });
console.log(String(withUnknown(made, 5).entries));
const withAny = (schema: Schema, entries: any) => ({ ...schema, entries });
console.log(String(withAny(made, 5).entries));
console.log(Object.keys(withAny(made, { key2: { kind: "number" } }).entries).join());
console.log(Object.keys(withAny(made, made.entries).entries).join(), withAny(made, 5).count, withAny(made, 5).type);
const declared = (schema: Schema, entries: any): Schema => ({ ...schema, entries });
console.log(Object.keys(declared(made, JSON.parse('{"key1":{"kind":"a"},"key2":{"kind":"b"}}')).entries).join());
const withCount = (schema: Schema, count: number) => ({ ...schema, count });
console.log(withCount(made, 2).count, Object.keys(withCount(made, 2).entries).join());
console.log(Object.keys(made.entries).join(), made.count);
