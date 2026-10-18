// A compiled validator that refuses a value tells the shared routine where it failed (recordFailure), and the call takes the issues that were recorded (takeIssues).
// This models the emitted code in JavaScript, over random plans and values made from them, and compares with a walk of the whole value (issuesOf).
import { expect, test } from "bun:test";
import { isASAN, isDebug } from "harness";
import { issuesOf, recordFailure, safeValidateByPlan, takeIssues } from "../../../src/js/internal/validation.ts";

let seed = 777;
function next(): number {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return seed >>> 0;
}
const pick = (count: number) => next() % count;
const names = ["a", "b", "kind", "x"];

function randomRules(kind: string): any[] {
  const rules: any[] = [];
  if (pick(3)) return rules;
  if (kind === "number") {
    rules.push([["int"], ["min", 1], ["max", 3]][pick(3)]);
    if (pick(2)) rules.push([["int"], ["min", 2], ["max", 0]][pick(3)]);
  }
  if (kind === "string") rules.push([["minLength", 2], ["maxLength", 2], ["pattern", "^a"]][pick(3)]);
  if (kind === "array") rules.push([["minLength", 1], ["maxLength", 2]][pick(2)]);
  return rules;
}

function randomPlan(): any[] {
  const nodes: any[] = [];
  const add = (depth: number): number => {
    const at = nodes.length;
    nodes.push(null);
    const kinds = depth > 3 ? [0, 2, 2, 3, 10] : [0, 2, 2, 3, 5, 5, 5, 6, 7, 8, 8, 8, 8, 8, 9, 10];
    const kind = depth === 0 ? [8, 8, 8, 5, 9, 2][pick(6)] : kinds[pick(kinds.length)];
    let node: any[];
    switch (kind) {
      case 2: {
        const name = ["number", "string", "boolean"][pick(3)];
        node = [2, name, null, randomRules(name)];
        break;
      }
      case 3:
        node = [3, [1, "a", true, null][pick(4)], null, []];
        break;
      case 5:
        node = [5, add(depth + 1), null, randomRules("array")];
        break;
      case 6:
        node = [6, Array.from({ length: pick(3) }, () => add(depth + 1)), null, []];
        break;
      case 7:
        node = [7, add(depth + 1), null, []];
        break;
      case 8: {
        const members = names.slice(0, pick(5)).map(name => [name, add(depth + 1), pick(4)]);
        const others = [-1, -1, -2, -3][pick(4)];
        node = [8, members, others === -3 ? add(depth + 1) : others, []];
        break;
      }
      case 9:
        node = [9, Array.from({ length: 1 + pick(3) }, () => add(depth + 1)), null, []];
        break;
      default:
        node = [kind, null, null, []];
    }
    node.push(pick(8) ? null : "custom", false, null);
    if (!pick(10)) {
      node[5] = true;
      node[6] = [1, "a", null][pick(3)];
    }
    nodes[at] = node;
    return at;
  };
  const root = add(0);
  for (const node of nodes) {
    if (node[0] !== 8) continue;
    for (const member of node[1]) {
      const absent = safeValidateByPlan([member[1], nodes], undefined);
      if (!(member[2] & 1) && absent.success && absent.data === undefined) member[2] |= 4;
    }
    node.push(
      node[1].map((member: any) => {
        const child = nodes[member[1]];
        return child[0] === 2 && child[3].length === 0 && !child[5] ? 1 + ["number", "string", "boolean"].indexOf(child[1]) : 0;
      }),
    );
  }
  return [root, nodes, [undefined]];
}

function randomValue(depth: number): any {
  switch (pick(depth > 3 ? 7 : 12)) {
    case 0:
      return undefined;
    case 1:
      return null;
    case 2:
      return pick(5);
    case 3:
      return ["a", "ab", "abc", "b"][pick(4)];
    case 4:
      return !!pick(2);
    case 5:
      return NaN;
    case 6:
      return 1.5;
    case 7:
    case 8:
      return Array.from({ length: pick(4) }, () => randomValue(depth + 1));
    default: {
      const made: any = {};
      for (const name of [...names, "extra"]) if (pick(4)) made[name] = randomValue(depth + 1);
      return made;
    }
  }
}

function valueFor(plan: any[], at: number, depth: number): any {
  if (!pick(9)) return randomValue(depth + 2);
  const node = plan[1][at];
  switch (node[0]) {
    case 2:
      return node[1] === "number" ? [0, 1, 2, 3, 4, 1.5][pick(6)] : node[1] === "string" ? ["a", "ab", "abc", "b"][pick(4)] : !!pick(2);
    case 3:
      return node[1];
    case 5:
      return Array.from({ length: pick(4) }, () => valueFor(plan, node[1], depth + 1));
    case 6:
      return node[1].map((element: number) => valueFor(plan, element, depth + 1));
    case 7: {
      const made: any = {};
      for (const name of ["p", "q"]) if (pick(2)) made[name] = valueFor(plan, node[1], depth + 1);
      return made;
    }
    case 8: {
      const made: any = {};
      for (const member of node[1]) if (!(member[2] & 1) || pick(2)) made[member[0]] = valueFor(plan, member[1], depth + 1);
      if (!pick(5)) made.extra = node[2] >= 0 ? valueFor(plan, node[2], depth + 1) : 1;
      return made;
    }
    case 9:
      return valueFor(plan, node[1][pick(node[1].length)], depth + 1);
    case 10:
      return undefined;
    default:
      return randomValue(depth + 2);
  }
}

const refused = {};
const isPlainObject = (value: any) => typeof value === "object" && value !== null && !Array.isArray(value);

function recordsIssues(plan: any[], at: number, isSpeculative: boolean): boolean {
  const node = plan[1][at];
  return !isSpeculative && (node[0] === 8 || node[0] === 5) && !node[5] && (node[3].length === 0 || node[0] === 5);
}

function recordingValidatorBelow(plan: any[], at: number): any {
  if (!recordsIssues(plan, at, false)) return undefined;
  const node = plan[1][at];
  if (node[0] === 8) return (value: any) => (validate(plan, at, value, false) === refused ? undefined : true);
  return plan[1][node[1]][0] === 8 ? recordingValidatorBelow(plan, node[1]) : undefined;
}

function validatorsOfMembers(plan: any[], at: number): any {
  const listed: any[] = [];
  plan[1][at][1].forEach((member: any, position: number) => {
    const validator = recordingValidatorBelow(plan, member[1]);
    if (validator !== undefined) listed.push(position, validator);
  });
  return listed.length ? listed : undefined;
}

function validate(plan: any[], at: number, input: any, isSpeculative: boolean): any {
  const node = plan[1][at];
  if (node[5] && input === undefined) input = node[6];
  const quietly = () => (safeValidateByPlan([at, plan[1]], input).success ? true : refused);
  if (!recordsIssues(plan, at, isSpeculative)) return quietly();
  if (node[0] === 5) {
    if (!Array.isArray(input)) return refused;
    const anything = [0, null, null, [], null, false, null];
    if (!safeValidateByPlan([0, [[5, 1, null, node[3], null, false, null], anything]], input).success) return refused;
    for (let i = 0; i < input.length; i++) {
      if (validate(plan, node[1], input[i], false) !== refused) continue;
      recordFailure(plan, at, i, input, recordingValidatorBelow(plan, at));
      return refused;
    }
    return true;
  }
  const fail = (position: number) => {
    recordFailure(plan, at, position, input, validatorsOfMembers(plan, at));
    return refused;
  };
  if (!isPlainObject(input)) return fail(0);
  const members = node[1];
  for (let position = 0; position < members.length; position++) {
    const [name, below, flags] = members[position];
    if (validate(plan, below, input[name], false) === refused) return fail(position);
    if (flags & 4 && !Object.hasOwn(input, name)) return fail(position);
  }
  if (node[2] === -1) return true;
  for (const key of Object.keys(input)) {
    if (members.some((member: any) => member[0] === key)) continue;
    if (node[2] === -2 || validate(plan, node[2], input[key], true) === refused) return fail(members.length);
  }
  return true;
}

test("the issues that validators record are the issues of a walk of the whole value", () => {
  let refusals = 0;
  let withRecordedIssues = 0;
  const plans = isASAN || isDebug ? 5000 : 20000;
  for (let i = 0; i < plans; i++) {
    const plan = randomPlan();
    for (let j = 0; j < 6; j++) {
      const value = j < 5 ? valueFor(plan, plan[0], 0) : randomValue(0);
      const isAccepted = safeValidateByPlan(plan, value).success;
      expect(validate(plan, plan[0], value, false) !== refused).toBe(isAccepted);
      if (isAccepted) {
        expect(plan[2][0]).toBeUndefined();
        continue;
      }
      refusals++;
      if (plan[2][0] !== undefined) withRecordedIssues++;
      expect(takeIssues(plan, value)).toEqual(issuesOf(plan, value));
      expect(plan[2][0]).toBeUndefined();
    }
  }
  expect(refusals).toBeGreaterThan(plans * 2);
  expect(withRecordedIssues).toBeGreaterThan(plans);
});
