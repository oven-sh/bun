import { afterAll, expect, setDefaultTimeout } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run as runProcess } from "./harness/run";
import { beforeAll, describe, test } from "./supported";

// In an executable built with --aot-validate the end of each collection compares every row of the property caches with the Structures
// it names, and stops the program with CacheHitDiffers where they disagree. Two states looked like a stale row and were none.
// That a stale row still stops the run is tested beside the engine: property-lookup-table/validator-stops-at-stale-rows.

// The Structure that a cached addition leads to drops its chain at a collection. Later two links below the Structure that the row is
// filed under drop theirs, and the lower one dies, so no walk from the base reaches that Structure any more. A record still has it.
// Other records build the like chain anew, and the end takes that one for its own: it names another predecessor than the row does.
const anotherChainIsTakenForTheOldOne = `const hide = value => new CustomEvent("x", { detail: value }).detail;
const names = Array.from({ length: 17 }, (_, i) => "option" + i);
const textOf = count => "{" + names.slice(0, count).map((name, i) => JSON.stringify(name) + ":" + i).join(",") + "}";
const parse = count => hide(JSON.parse(textOf(count)));
function finish(record) { record.allowed = true; return record; }
function describe(o) { let s = ""; for (const k in o) s += k + "=" + o[k] + ";"; return s; }
const collect = () => { Bun.gc(true); Bun.gc(true); };
function first() {
  const whole = [];
  for (let i = 0; i < 6; i++) whole.push(finish(parse(17)));
  Bun.gc(true);
  return whole[5];
}
function second() {
  const eight = parse(8), sixteen = parse(16);
  const lengths = Object.keys(eight).length + Object.keys(sixteen).length;
  Bun.gc(true);
  return lengths;
}
const bare = parse(17);
const whole = first();
const lengths = second();
for (let i = 0; i < 3000; i++) hide({ a: i, b: [i] });
collect();
const fresh = [];
for (let i = 0; i < 4; i++) fresh.push(finish(parse(17)));
collect();
const late = finish(bare);
collect();
const expected = names.map((name, i) => name + "=" + i + ";").join("") + "allowed=true;";
console.log(describe(late) === expected, describe(fresh[3]) === expected, describe(whole) === expected, lengths, Object.keys(late).length);
`;

// What stands for the prototype object of a class becomes an ordinary object and gets a closure for each method, and says so behind
// that. With this many methods a collection ends in between.
const numberOfMethods = 3000;
const aPrototypeObjectGetsItsMembers = `const hide = value => new CustomEvent("x", { detail: value }).detail;
class C { ${Array.from({ length: numberOfMethods }, (_, i) => `m${i}() { return ${i}; }`).join(" ")} get g() { return "g"; } }
const first = o => o.m0, seventh = o => o.m7, last = o => o.m${numberOfMethods - 1}, getter = o => o.g, absent = o => o.absent, byKey = (o, k) => o[k];
const look = o => [typeof first(o), typeof seventh(o), typeof last(o), getter(o), absent(o), typeof byKey(o, "m11")].join();
const o = hide(Object.create(C.prototype));
let before = "";
for (let i = 0; i < 400; i++) before = look(o);
console.log(before, Object.getOwnPropertyNames(hide(C.prototype)).length, look(o));
`;

setDefaultTimeout(300_000);

describe("validation of the property caches", () => {
  const dir = tempDir("validation-of-the-property-caches", {
    "another-chain.js": anotherChainIsTakenForTheOldOne,
    "members.js": aPrototypeObjectGetsItsMembers,
  });

  beforeAll(async () => {
    for (const name of ["another-chain", "members"]) {
      const built = await runProcess(
        [bunExe(), "build", "--compile", "--aot", "--aot-validate", name + ".js", "--outfile", join(String(dir), name)],
        String(dir),
        bunEnv,
      );
      expect(built.stderr).not.toContain("error:");
      expect(built.exitCode).toBe(0);
    }
  });

  afterAll(() => dir[Symbol.dispose]());

  test("an addition whose new Structure has taken the like chain of other objects for its own", async () => {
    const { stdout, stderr, exitCode } = await runProcess([join(String(dir), "another-chain")], String(dir), bunEnv);
    expect(stderr).not.toContain("AOT validation: ");
    expect({ stdout, exitCode }).toEqual({ stdout: "true true true 24 18\n", exitCode: 0 });
  });

  test.each(["1", "3", "7"])(
    "a collection while a prototype object gets its members, at every %s. allocation off the fast path",
    async every => {
      const env = { ...bunEnv, BUN_JSC_slowPathAllocsBetweenGCs: every };
      const { stdout, stderr, exitCode } = await runProcess([join(String(dir), "members")], String(dir), env);
      expect(stderr).not.toContain("AOT validation: ");
      const looks = "function,function,function,g,,function";
      expect({ stdout, exitCode }).toEqual({ stdout: `${looks} ${numberOfMethods + 2} ${looks}\n`, exitCode: 0 });
    },
  );
});
