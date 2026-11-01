import { beforeEach, afterEach, beforeAll } from "../../harness/declare";
import { Shape } from "fake-shapes";
import { Vec2 } from "fake-typed";
import { register } from "./store";
declare global { var preloaded: { runs: number; before: number; after: number; all: number; shape: Shape; vec: Vec2; registered: number } }
globalThis.preloaded = { runs: (globalThis.preloaded?.runs ?? 0) + 1, before: 0, after: 0, all: 0, shape: new Shape("from the preload"), vec: new Vec2(1, 2), registered: register(n => n + 1000) };
beforeAll(() => { globalThis.preloaded.all++; });
beforeEach(() => { globalThis.preloaded.before++; });
afterEach(() => { globalThis.preloaded.after++; });
