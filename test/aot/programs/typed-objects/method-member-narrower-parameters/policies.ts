import { NONE, type Constraints, type Policy, type Trust } from "./trust";

export function neverReads(name: string): Policy {
  return {
    name,
    constraints: (tool: string, dir: string, _call: Trust = NONE): Constraints => ({ allowed: tool !== "rm", dir, said: "-" }),
  };
}
export function reads(name: string): Policy {
  return {
    name,
    constraints: (tool: string, dir: string, call: Trust = NONE): Constraints => ({ allowed: call.attested, dir, said: tool + " " + call.decidedByHost + " " + ("decidedByHost" in call) }),
  };
}
export function aFunctionExpression(name: string): Policy {
  return {
    name,
    constraints: function (tool: string, dir: string, call: Trust = NONE): Constraints {
      return { allowed: call.attested, dir, said: tool + " " + (call.decidedByHost ?? "not decided") };
    },
  };
}
export function aMethod(name: string): Policy {
  return {
    name,
    constraints(tool: string, dir: string, call: Trust = NONE): Constraints {
      return { allowed: call.attested, dir, said: this.name.length + " " + tool + " " + call.decidedByHost };
    },
  };
}
function declared(tool: string, dir: string, call: Trust = NONE): Constraints {
  return { allowed: call.attested, dir, said: tool + " " + String(call.decidedByHost) };
}
export function byItsName(name: string): Policy {
  return { name, constraints: declared };
}
const constraints = (tool: string, dir: string, call: Trust = NONE): Constraints => ({ allowed: call.attested, dir, said: tool + " " + JSON.stringify(call) });
export function aConstantByItsName(name: string): Policy {
  return { name, constraints };
}
export function calledByTheirNames(): string {
  return declared("ls", "/e", { attested: true, decidedByHost: true }).said + " " + constraints("ls", "/e").said;
}
export function reuses(name: string, other: Policy): Policy {
  return { name, constraints: other.constraints };
}
const assigned: Policy = neverReads("assigned");
assigned.constraints = (tool: string, dir: string, call: Trust = NONE): Constraints => ({ allowed: call.attested, dir, said: tool + " " + Object.keys(call).join() });
export { assigned };
