// A member declared with method syntax may be given a function whose parameter asks for more than the member promises: TypeScript compares the parameters of methods both ways. The function is then handed an object that lacks a member its parameter requires, as in plain JavaScript.
import { aConstantByItsName, aFunctionExpression, aMethod, assigned, byItsName, calledByTheirNames, neverReads, reads, reuses } from "./policies";
import type { Policy } from "./trust";

type Deps = { policy: Policy; dir: string };
function run(deps: Deps, tool: string, facts: { attested: boolean }): string {
  const c = deps.policy.constraints(tool, deps.dir, { attested: facts.attested });
  return deps.policy.name + ": " + c.allowed + " " + c.dir + " " + c.said;
}

const first = neverReads("never reads it");
for (const policy of [first, reuses("reuses it", first), reads("reads it"), aFunctionExpression("a function expression"), aMethod("a method"), byItsName("by its name"), aConstantByItsName("a constant by its name"), assigned]) {
  console.log(run({ policy, dir: "/a" }, "ls", { attested: true }));
  console.log(run({ policy, dir: "/b" }, "rm", { attested: false }));
  const left = policy.constraints("ls", "/c");
  console.log(policy.name + ", left out: " + left.allowed + " " + left.said);
  const whole = policy.constraints("ls", "/d", { attested: true, decidedByHost: true } as { attested: boolean });
  console.log(policy.name + ", whole: " + whole.allowed + " " + whole.said);
}
console.log(calledByTheirNames());
