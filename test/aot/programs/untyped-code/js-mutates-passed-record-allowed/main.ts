// JavaScript of the program may do to an object that typed code has handed it whatever the language allows: store a value of another kind into a field, make the field an accessor, turn one member of a union into another. Nothing of that is refused: that one object is an ordinary object from then on, and typed code reads it as it reads any object from outside.
// The objects reach the JavaScript in two ways: it imports the functions that make them, or typed code hands them to it in a call. What the JavaScript leaves behind fits the type again.
// IR+ : =?L[0-9]+ = NewObject 
import { alter, deeds, run } from "./view.js";
import { makeCounter, makeHolder, makeState, showCounter, showHolder, showState } from "./state.ts";

console.log(run());
for (let round = 0; round < 2; round++) {
  for (const deed of deeds as string[]) {
    const seen: string[] = [];
    const counter = makeCounter();
    alter(counter, "count", deed, 2, seen);
    const holder = makeHolder();
    alter(holder, "count", deed, 2, seen);
    const state = makeState();
    alter(state, "open", deed, false, seen);
    console.log(
      round,
      "handed over",
      deed,
      seen.join(),
      showCounter(counter),
      showHolder(holder),
      showState(state),
      JSON.stringify([counter, holder, state]),
    );
  }
}
const untouched = makeCounter();
console.log(showCounter(untouched), Object.keys(untouched).join());
