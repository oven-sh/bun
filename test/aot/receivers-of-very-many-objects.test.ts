// Two receivers that may each be any of two hundred objects share a third of them, and read and write names that single objects read and write too.
// Flow links receivers of very many objects through the sets of objects they share.
// No test program is that large, so the limit is lowered.
import { expect } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { unsupported } from "./harness/compiler";
import { describe, test } from "./harness/declare";
import { run } from "./harness/run";
import { sharedBuilds } from "./harness/shared-builds";

const groups = 5;
// Each group lies in a variable of its own, and each loop is written out: flow does not tell the elements of one array apart, and a function that both receivers were passed to would see one receiver.
const programWith = (
  count: number,
) => `${Array.from({ length: groups }, (_, group) => `const group${group} = [];`).join("\n")}
${Array.from({ length: count }, (_, index) => `const object${index} = { value: ${index}, only${index}: ${index} }; group${index % groups}.push(object${index});`).join("\n")}
const printed = [];
const first = [...group0, ...group1, ...group2];
const last = [...group2, ...group3, ...group4];

// Single objects write; both receivers read.
object0.handler = function inFirst() { return "in first"; };
object2.handler = function inBoth() { return "in both"; };
object4.handler = function inLast() { return "in last"; };
let foundInFirst = "";
for (const each of first) if (each.handler) foundInFirst += each.handler() + ", ";
let foundInLast = "";
for (const each of last) if (each.handler) foundInLast += each.handler() + ", ";
printed.push(foundInFirst, foundInLast);

// Both receivers write; single objects read.
for (const each of first) each.callback = function fromFirst() { return "from first " + this.value; };
for (const each of last) each.callback = function fromLast() { return "from last " + this.value; };
printed.push(object0.callback(), object1.callback(), object2.callback(), object3.callback(), object4.callback());

// One receiver writes; the other reads.
for (const each of first) each.mark = "first";
let marks = 0;
for (const each of last) if (each.mark === "first") ++marks;
for (const each of last) each.mark = { from: "last" };
let boxes = 0;
for (const each of first) if (typeof each.mark === "object" && each.mark.from === "last") ++boxes;
printed.push(marks, boxes, object0.mark, typeof object2.mark, typeof object4.mark);

// Under keys that are computed.
const keys = ["even", "odd"];
for (const each of first) each[keys[each.value & 1]] = function underKeyInFirst() { return "first under a key " + each.value; };
for (const each of last) each[keys[each.value & 1]] = function underKeyInLast() { return "last under a key " + each.value; };
printed.push(object0.even(), object1.odd(), object2.even(), object3.odd(), typeof object0.odd, typeof object3.even);
object10[keys[0]] = function written() { return "written on ten"; };
let writtenInFirst = 0;
for (const each of first) for (const key of keys) if (typeof each[key] === "function" && each[key]().startsWith("written")) ++writtenInFirst;
let writtenInLast = 0;
for (const each of last) for (const key of keys) if (typeof each[key] === "function" && each[key]().startsWith("written")) ++writtenInLast;
printed.push(writtenInFirst, writtenInLast);

// Functions that are reached only through what one receiver holds write names that the other receiver and single objects read.
for (const each of last) each.later = function later() { this.late = function late() { return "late " + this.value; }; object6.fromLater = "set by later"; return this; };
for (const each of first) if (each.later) each.later();
printed.push(object2.late(), typeof object0.late, typeof object4.late, object6.fromLater);

// A number written through one receiver comes back as a number, and a text written through the other as a text.
for (const each of first) each.value = each.value + 0.5;
for (const each of last) each.value = String(each.value);
printed.push(object0.value + 1, object2.value + 1, object4.value + 1);
object5.value = { boxed: true };
const kindsInFirst = new Set();
for (const each of first) kindsInFirst.add(typeof each.value);
const kindsInLast = new Set();
for (const each of last) kindsInLast.add(typeof each.value);
printed.push([...kindsInFirst].sort().join(), [...kindsInLast].sort().join());
console.log(printed.join("\\n"));
`;

describe.skipIf(!!unsupported)("receivers of very many objects", () => {
  // A build without flow compiles all of Bun's own modules, so the program that goes past the budget is tiny.
  const { folder, build } = sharedBuilds("receivers-of-very-many-objects", {
    "many.js": programWith(groups * 70),
  });
  const printedBy = async (cmd: string[]) => {
    const { stdout, exitCode } = await run(cmd, folder, bunEnv);
    return { stdout, exitCode };
  };

  test.each([["many.js", ["--aot-limit=MaxValueFlowObjectsListedByMember:64"]]])(
    "%s prints what it prints in plain Bun, built with %j",
    async (program, flags) => {
      const built = await build(program, "--aot", ...flags);
      expect(await printedBy([built.executable])).toEqual(await printedBy([bunExe(), program]));
    },
  );
});
