import {
__require
} from "http://localhost:8080/bun:wrap";
import * as $75175720 from "http://localhost:8080/node_modules/lodash/lodash.js";
var { shuffle} = __require($75175720);
export function test() {
  const foo = [1, 2, 3, 4, 6];
  const bar = shuffle(foo);
  console.assert(bar !== foo);
  console.assert(bar.length === foo.length);
  bar.sort();
  foo.sort();
  for (let i = 0;i < bar.length; i++) {
    console.assert(bar[i] === foo[i], "expected " + i + " to be " + foo[i]);
    console.assert(typeof bar[i] === "number");
    console.assert(typeof foo[i] === "number");
  }
  return testDone(import.meta.url);
}

//# sourceMappingURL=http://localhost:8080/lodash-regexp.js.map
