// A hook that is a type guard narrows the argument of its caller. The guarded parameter of each hook has a default, which the React Compiler moves into the body: the parameter itself gets another name.
import { useAssertedGiven, useAssertedString, useIsLine, useIsNumber, useIsString, useLine } from "./guards";

const [first, second, third, fourth]: unknown[] = ["guarded", 7, "asserted", "line"];
const given: string | undefined = ["given"].pop();

const parts: (string | number)[] = [];
if (useIsString(first, "b")) parts.push(first.length);
if (useIsNumber(second)) parts.push(second.toFixed(1));
useAssertedString(third);
parts.push(third.toUpperCase());
useAssertedGiven(given);
parts.push(given.length);
if (useIsLine(fourth)) parts.push(fourth.length);
console.log(useLine(parts).join());
