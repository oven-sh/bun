// When its input ends, the process prints how a new array is stored and exits.
import { jscDescribe } from "bun:jsc";

Bun.stdin.text().then(() => {
  console.log("new arrays:", /ArrayWith[A-Za-z]+/.exec(jscDescribe([1, {}]))![0]);
  process.exit(0);
});
