// A property is read straight into a call of something untyped: nothing typed looks at the value, so it is handed over as it is, whatever it is. The objects here do not fit the type they are looked at as: untyped code hands one in, and a cast lets one through. The same read into a parameter that is declared `any` has always been handed over.
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
  showDeclared(line.id, line.name);
  show(line.id, line.name);
}

feed(print);
print({ id: 1, name: "fits" });

const plain: any = { id: "seven", name: null };
const odd = plain as Line;
showDeclared(odd.id, odd.name);
show(odd.id, odd.name);

function made(): any {
  return { id: "nine", name: 9 };
}
const other: Line = made();
showDeclared(other.id, other.name);
show(other.id, other.name);
