// What is called as `lib.name()` is, in turn: a function constant, a let, a local function exported under another name, an anonymous default, a function that a barrel passes on, a method taken from an object, a bound-less copy of an import, a function that mentions `this` only in a default value. Each finds `other` through `this`.
import * as constant from "./constant.js";
import * as viaLet from "./let.js";
import * as renamed from "./renamed.js";
import * as anonymous from "./anonymous.js";
import * as barrel from "./barrel.js";
import * as fromObject from "./from-object.js";
import * as copied from "./copied.js";
import * as inDefault from "./in-default.js";

console.log(constant.start(), viaLet.start(), renamed.start(), anonymous.default());
console.log(barrel.start(), fromObject.start(), copied.start(), inDefault.start());
