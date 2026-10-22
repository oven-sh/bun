// The same in JavaScript, where no type checker looks at the file: the pragmas are the only mention of the imported factory and fragment, and tags the only mention of the components.
/* @jsxRuntime classic */
/* @jsx make */
/* @jsxFrag Group */
import { Group, make } from "./factory.js";
import * as ui from "./ui.js";
import { Plain } from "./ui.js";

console.log(<><Plain /><ui.Member /></>);
