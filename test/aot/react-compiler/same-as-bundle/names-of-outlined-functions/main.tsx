import { render } from "../react-stand-in/render";
import { useLabel, useLabels } from "./labels";

const names = (...marks: ((item: string) => string)[]) => marks.map(mark => `${mark.name}: ${mark("a")}`).join(", ");
console.log(render(useLabel, names));
console.log(render(useLabels, names));

// The message quotes the call, and so the name.
for (const hook of [useLabel, useLabels]) {
  try {
    render(hook, undefined);
  } catch (error) {
    console.log((error as Error).message);
  }
}
