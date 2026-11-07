import { render } from "../react-stand-in/render";
import { toldEarly, useChoice, useList } from "./hooks";

console.log(toldEarly);
const lists = [render(useList, undefined), render(useList, undefined)];
console.log(JSON.stringify(lists), lists[0] === lists[1]);
for (const isFirst of [false, false, true]) console.log(JSON.stringify(render(useChoice, { isFirst, first: 1, second: 2 })));
