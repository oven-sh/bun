// <ui.Button /> and <ui.forms.Input /> are the only references to what ui.tsx and forms.tsx export: member tags of a namespace import, one and two levels deep.
/* @jsxRuntime classic */
/* @jsx h */
import { h } from "./h";
import * as ui from "./ui";

console.log(<ui.Button label="ok" />);
console.log(<ui.forms.Input name="city"></ui.forms.Input>);
