// Each component renders three times: twice with one value, once with another. The output shows which calls ran again, and the cache sizes show the
// shape of the compiler's output. Both depend on what the parser did to the component before the compiler saw it.
import { render } from "../react-stand-in/render";
import * as Constants from "./Constants";
import * as Elements from "./Elements";
import * as Imports from "./Imports";
import * as LeftAlone from "./LeftAlone";
import * as Macros from "./Macros";
import * as Statements from "./Statements";

type Component = (props: { a: number }) => unknown;

function MainOfEntry({ a }: { a: number }) {
  "use memo";
  return import.meta.main ? [a, "main"] : [a];
}

const files: Record<string, Record<string, unknown>> = {
  Constants,
  Statements,
  Imports,
  Elements,
  Macros,
  LeftAlone,
  main: { MainOfEntry },
};
for (const [file, components] of Object.entries(files)) {
  for (const [name, component] of Object.entries(components)) {
    if (name === "useValue") continue;
    console.error(file, name);
    for (const a of [1, 1, 2]) console.log(file, name, a, JSON.stringify(render(component as Component, { a })));
  }
}
