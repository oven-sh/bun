import { render } from "../react-stand-in/render";
import { toldEarly, useList } from "./hooks.jsx";

console.log(toldEarly, JSON.stringify(render(useList, undefined)));
