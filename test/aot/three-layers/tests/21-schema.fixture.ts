import { check } from "../src/show";
import { s, type Infer } from "../src/store";
import { Schema, StringSchema, type Result } from "fake-typed/schema";
import { makeUser } from "../src/models";
const F = "21";
const User = s.object({ id: s.number().int().positive(), name: s.string().min(2), roles: s.string().array(), size: s.number().optional(), address: s.object({ city: s.string(), zip: s.string().optional() }).optional() });
export type UserT = Infer<typeof User>;
class Email extends StringSchema { override readonly kind = "string" as const; protected override base(value: unknown, path: string): Result<string> { const r = super.base(value, path); return r.ok && !r.value.includes("@") ? { ok: false, issues: [path + ": not an email"] } : r; } }
check(F, "parse", () => [User.parse(makeUser(3)), User.parse(makeUser(1)), User.parse({ id: -1.5, name: "x", roles: [1, "a"], address: { city: 2 } }), User.parse(null), User.parse([]), User.keys()]);
check(F, "chains make copies", () => { const a = s.string(), b = a.min(2), c = b.min(4); return [a === b, a.parse("x").ok, b.parse("x").ok, c.parse("abc"), c.parse("abcd").ok, b instanceof StringSchema, b instanceof Schema, b.kind, Object.keys(b)]; });
check(F, "extend, transform, subclass", () => { const Extended = User.extend({ email: new Email().min(3), age: s.number().transform(n => n + " years") }); const u = makeUser(2); return [Extended.parse({ ...u, email: "a@b", age: 3 }), Extended.parse({ ...u, email: "ab", age: "3" }), Extended.keys(), new Email().optional().parse(undefined), new Email().array().parse(["a@b", "c"])]; });
check(F, "refine with a closure of the test", () => { let calls = 0; const even = s.number().refine(n => (calls++, n % 2 === 0), "odd"); return [even.parse(2), even.parse(3), even.array().parse([2, 4, 5]), calls]; });
