import { EventEmitter } from "events";
import { expectType } from "./utilities";

// eslint-disable-next-line @definitelytyped/no-single-element-tuple-type
// EventEmitter<
// const e1 = new EventEmitter<{ a: [string] }>();

// e1.on("a", (arg) => {
//     expectType<string>(arg);
// });
// // @ts-expect-error
// e1.on("qwer", (_) => {});

const e2 = new EventEmitter();
e2.on("qwer", (_: any) => {
  _;
});
e2.on("asdf", arg => {
  expectType<any>(arg);
});
