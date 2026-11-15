// Each component renders three times: twice with equal props, once with others. The components are pure, so the output is the same with the compiler off.
import { render } from "../react-stand-in/render";
import * as JoinedText from "./JoinedText";
import * as Shapes from "./Shapes";

type Component = (props: unknown) => unknown;

const list = [1, 2, 3];
const allProps = [
  { a: 1, text: "x", list, nested: { value: 7 } },
  { a: 1, text: "x", list, nested: { value: 7 } },
  { a: 2, text: "y", list: [3, 4], nested: null },
];
for (const [name, component] of Object.entries({ ...Shapes, ...JoinedText })) {
  for (const props of allProps) console.log(name, JSON.stringify(render(component as Component, props)));
}
