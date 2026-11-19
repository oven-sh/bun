import { spyOn } from "bun:test";
import * as renamed from "../src/spies/barrel-as";
import { add, callsAdd } from "pkg-esm";
import { seenBySrc } from "../src/spies/uses";
import { say } from "../src/spies/say";
const all = () => [renamed.plus(1, 2), renamed.all.add(1, 2), add(1, 2), callsAdd(1, 2), seenBySrc()];
say("52", "export { x as y } from", () => { const before = all(); const spy = spyOn(renamed, "plus").mockImplementation(() => 100); const during = all(); spy.mockRestore(); return [before, during, all()]; });
say("52", "export * as all from", () => { const before = all(); const spy = spyOn(renamed.all, "add").mockImplementation(() => 300); const during = all(); spy.mockRestore(); return [before, during, all()]; });
