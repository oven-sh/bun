// A function of a component file keeps its `length` and its defaults. The compiler moves each default into the body, and `= undefined` stands where the first one was: that parameter is `T | undefined`, or `any` where it has no annotation.
import { Card, useRange, useStep } from "./Card";
import { useLabel } from "./label.jsx";

console.log(Card.length, useStep.length, useRange.length, useLabel.length);
console.log(useStep(), useStep(3), useStep(undefined, 3), useRange(undefined, 3), useRange(1, 3));
console.log(useLabel("a"), useLabel("a", "?"), useLabel("a", undefined));
console.log(Card({ n: 2 }));
