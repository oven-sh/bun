import { log } from "./log";
import type { Shape as A } from "./whole-type";
import { type Shape as B } from "./inline-type";
import { type Model as C, type Shape as D } from "./named-type";
import type E from "./default-type";
import { type Shape as F, value } from "./mixed";
import type * as G from "./namespace-type";
import type { Shape as H } from "./again";
import "./bare";
import { value as neverUsed } from "./unused-value";
import NeverUsed from "./unused-default";
import * as neverUsedEither from "./unused-namespace";
import { Model } from "./used";

const a: A = { sides: 1 };
const b: B = { sides: 2 };
const c: C = { sides: 3 };
const d: D = { sides: 4 };
const e: E = { name: "e" };
const f: F = { sides: 6 };
const g: G.Shape = { sides: 7 };
const h: H = { sides: 8 };

console.log("modules that ran: " + log.join(", "));
console.log([a.sides, b.sides, c.sides, d.sides, e.name, f.sides, g.sides, h.sides, value, new Model().sides].join(" "));
console.log("c is a Model of another module: " + (c instanceof Model));
