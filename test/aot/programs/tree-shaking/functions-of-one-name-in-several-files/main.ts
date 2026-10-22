// Every file has a `run` and a `helper`. Only those of b.ts and, through a renamed re-export, of c.ts are used; what counts is the binding, not the name.
import { run, runOfC } from "./barrel";

function helper() {
  return "helper of main";
}

console.log(run(), runOfC(), helper());
