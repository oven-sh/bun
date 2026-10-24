// An object literal in run-time text reaches typed code. The fields of the type are typed.
interface Payload { value: unknown; issues: string[]; aborted?: boolean }
function check(p: Payload): number { return p.issues.length + (p.aborted ? 1 : 0) + (typeof p.value === "number" ? p.value : 0); }
function own(i: number): number { return check({ value: i, issues: [] }); }
const text = "return check({ value: i, issues: [] })";
const made = new Function("check", "i", text) as (c: typeof check, i: number) => number;
const turns = 1000;
let sum = own(1) + check(JSON.parse("{\"value\":1,\"issues\":[]}"));
for (let i = 0; i < turns; i++) sum += made(check, i & 7);
console.log(sum);
