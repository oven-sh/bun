// The pragmas say lib.make and lib.Group: the namespace import `lib` has no other use, and neither have the two exports.
/* @jsxRuntime classic */
/* @jsx lib.make */
/* @jsxFrag lib.Group */
import * as lib from "./lib";

console.log(<><a /><b>text</b></>);
