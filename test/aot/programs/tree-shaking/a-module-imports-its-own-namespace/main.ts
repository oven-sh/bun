// The entry point imports itself. Its exports are called through its own namespace object under computed names, and helper.ts does the same from outside.
import * as self from "./main";
import { callEntry } from "./helper";

export function first() { return "first"; }
export const second = () => "second";
export class Third {
  name() { return "third"; }
}
export default function fourth() { return "fourth"; }

const table = self as Record<string, any>;
console.log(table["fir" + "st"](), table["sec" + "ond"](), new table["Thi" + "rd"]().name(), table["def" + "ault"]());
console.log(callEntry("first"));
