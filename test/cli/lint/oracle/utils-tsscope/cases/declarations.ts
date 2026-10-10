namespace A.B.C { export const x = 1; const y = 2; }
namespace Plain { const inner = Plain; }
namespace Twice { export interface I {} }
namespace Twice { export interface I {} const unused = 1; }
declare global { var inGlobal: number; }
const global = 1;
declare module "m" { const a: number; export const b: number; }
enum E { a, b = a, "c" = 1, d = E.a }
enum Unused { x }
const enum Const { y }
export enum Exported { z }
function self() { self(); }
const arrow = () => arrow();
const wrapped = (() => wrapped()) as any;
const expression = function named() { named(); expression(); };
const { destructured } = function () { destructured; };
type Alias = Alias[];
interface Iface { a: Iface }
type Used = 1; let u: Used; u;
const value = 1; type value = 2; let v: value; v;
export interface MergedExport {}
const MergedExport = 1;
interface MergedValueExport {}
export const MergedValueExport = 1;
import type { OnlyType } from "a";
import { type Inline, Value, AsType } from "a";
import Default, * as Namespace from "a";
import Equals = require("a");
import type TypeEquals = require("a");
export import Reexported = Namespace.x;
let t1: OnlyType, t2: Inline, t3: AsType, t4: typeof Value, t5: TypeEquals; t1; t2; t3; t4; t5;
try {} catch (e) {} try {} catch ({ message }) {} try {} catch (used) { used; }
function params(a, b, { c, d: [e] }, f = 1, ...g) { b; }
function thisParam(this: Window, a) {}
class P { constructor(private a, public b = 1, c) {} }
function predicate(x: unknown): x is string { return true; }
function asserts(y: unknown): asserts y {}
export { params, thisParam, P, predicate, asserts };
export default value;
