// A property read through a declared type is a typed read whatever the value is used for: read straight into a call of something untyped, or into a parameter declared `any`, a field of another kind throws. A missing field is undefined, and null passes. The objects here do not fit the type they are looked at as: untyped code hands one in, a cast lets one through, and a function that returns `any` makes one.
import { feed } from "./feed.js";

export interface Line {
  id: number;
  name: string;
}

const show: any = (...values: unknown[]) => console.log(values.join(" | "));
function showDeclared(...values: any[]) {
  console.log(values.join(" | "));
}

export function print(line: Line) {
  try { showDeclared(line.id, line.name); } catch (e) { console.log("into a parameter declared any:", (e as Error).constructor.name); }
  try { show(line.id, line.name); } catch (e) { console.log("into a call of something untyped:", (e as Error).constructor.name); }
}

feed(print);
print({ id: 1, name: "fits" });

const plain: any = { id: "seven", name: null };
const odd: Line = plain as Line;
try { showDeclared(odd.id, odd.name); } catch (e) { console.log("into a parameter declared any:", (e as Error).constructor.name); }
try { show(odd.id, odd.name); } catch (e) { console.log("into a call of something untyped:", (e as Error).constructor.name); }

function made(): any {
  return { id: "nine", name: 9 };
}
const other: Line = made();
try { showDeclared(other.id, other.name); } catch (e) { console.log("into a parameter declared any:", (e as Error).constructor.name); }
try { show(other.id, other.name); } catch (e) { console.log("into a call of something untyped:", (e as Error).constructor.name); }
