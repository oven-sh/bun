import { spyOn } from "bun:test";
import * as star from "../src/spies/barrel-star";
import { add } from "pkg-esm";
import { callsAdd } from "pkg-esm";
import { seenBySrc } from "../src/spies/uses";
import { say } from "../src/spies/say";
const all = () => [star.add(1, 2), add(1, 2), callsAdd(1, 2), seenBySrc()];
say("50", "a barrel with export *", () => { const before = all(); const spy = spyOn(star, "add").mockImplementation(() => 100); const during = all(); const calls = spy.mock.calls.length; spy.mockRestore(); return [before, during, calls, all()]; });
