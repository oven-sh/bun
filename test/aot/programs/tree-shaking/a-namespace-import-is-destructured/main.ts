// A namespace import is taken apart by patterns: a plain name, a renamed one, a default that is not used, a computed key, a nested pattern and a rest element.
import * as lib from "./lib";

const key = "comp" + "uted";
const { plain, renamed: other, withDefault = () => "the default", [key as "computed"]: computed, Box: { make }, ...rest } = lib;
console.log(plain(), other(), withDefault(), computed(), make());
console.log(Object.keys(rest).join(), rest.first(), rest.second());

function parameter({ inParameter }: typeof lib) {
  return inParameter();
}
console.log(parameter(lib));

let assigned: () => string;
({ assigned } = lib);
console.log(assigned());
