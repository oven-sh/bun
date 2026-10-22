// One result of the flow analysis is switched off at a time. Each result is a true statement about the program, so any subset may be applied: what relied on the missing one takes the tested path, and the answers must be the same. A difference names a result that another one silently depends on.
import { flowResultKinds } from "./flow-result-kinds";
import { variant } from "./run-programs";

const file = 8;
flowResultKinds.forEach((kind, index) => {
  if (index % 8 === file - 1) variant(`without-flow-result/${kind}`, [`--aot-disable=flow:${kind}`], {}, file, 8);
});
