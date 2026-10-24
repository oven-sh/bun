import { drop, entry, grow, shared, shorten, turn } from "./changes.ts";
import { isMissing, kinds, missing, shout, sum, use, widths } from "./reads.ts";

function attempt(label: string, run: () => unknown): void {
  let line: string;
  try {
    line = String(run());
  } catch (error) {
    line = "threw " + (error instanceof Error ? error.constructor.name : String(error));
  }
  console.log(label + " -> " + line);
}

let total = 0;
for (let i = 0; i < 2000; i++) total += sum([i, 1]) + widths(["a", "bc"]) + use([i, "n"]).length + missing([i]);
console.log("2000 honest rounds: " + total);

attempt("the shared list", () => [sum(shared), kinds(shared), missing(shared)].join(" "));
grow(shared, 5);
attempt("made longer", () => [sum(shared), kinds(shared), missing(shared), isMissing(shared[4]), shared.length].join(" "));
grow(shared, 3);
drop(shared, 1);
attempt("cut again, and one is deleted", () => [sum(shared), kinds(shared), missing(shared), isMissing(shared[1]), 1 in shared].join(" "));
shared[1] = 0.5;
attempt("stored to again", () => [sum(shared), kinds(shared), missing(shared), isMissing(shared[1])].join(" "));

const local = [1, 2, 3];
grow(local, 4);
attempt("a local list made longer", () => [sum(local), kinds(local), missing(local), isMissing(local[3])].join(" "));
const strings = ["a", "b"];
grow(strings, 3);
attempt("strings made longer", () => widths(strings));

attempt("the shared tuple", () => use(entry) + " " + shout(entry));
turn(entry);
attempt("turned around", () => use(entry));
attempt("turned around: a method", () => shout(entry));
turn(entry);
shorten(entry);
attempt("turned back and made shorter", () => use(entry) + " " + entry.length);
attempt("turned back and made shorter: a method", () => shout(entry));
