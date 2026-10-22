// Constants whose values a compiler knows: numbers, strings, booleans, sums of others, enum members, constants of another file. The code that reads them may get the value put in place of the name. Each is read in a way that still needs the right value: as a key, in a template, in a switch, as a default, in a closure that runs later, through an export, before its declaration in a function that is called afterwards.
import { REMOTE, REMOTE_SUM, RemoteLevel } from "./constants";
import * as constants from "./constants";

function early() { return [LATE, LATE_SUM, LateLevel.High].join(); }
const ONE = 1;
const TWO = ONE + 1;
const TEXT = "te" + "xt";
const FLAG = !ONE;
const NESTED = { value: TWO };
enum Level { Low = ONE, High = TWO * 2 }
const UNUSED = TWO * 100;
const table = { [ONE]: "one", [TEXT]: "text", [Level.High]: "high" };
const later = () => TWO + REMOTE;
function withDefault(value = TWO, other = REMOTE_SUM) { return value + other; }
function choose(n: number) {
  switch (n) {
    case ONE: return "ONE";
    case TWO: return "TWO";
    case REMOTE: return "REMOTE";
    default: return "none";
  }
}
const LATE = 7;
const LATE_SUM = LATE + ONE;
enum LateLevel { High = LATE * 2 }
export const EXPORTED = TWO + 40;

console.log(table[1], table.text, table[4], `${TWO}${TEXT}${FLAG}`, NESTED.value, later(), withDefault(), choose(1), choose(2), choose(10), choose(3));
console.log(early(), constants.REMOTE, (constants as any)["REMOTE" + "_SUM"], RemoteLevel.Top, constants.RemoteLevel[RemoteLevel.Top], EXPORTED);
