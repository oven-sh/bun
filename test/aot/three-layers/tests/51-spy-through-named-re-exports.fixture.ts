import { spyOn } from "bun:test";
import * as named from "../src/spies/barrel-named";
import { add, callsAdd, callsTwice, callsInner } from "pkg-esm";
import { seenBySrc } from "../src/spies/uses";
import { say } from "../src/spies/say";
const all = () => [named.add(1, 2), add(1, 2), callsAdd(1, 2), named.twice(4), callsTwice(4), named.inner(), callsInner(), seenBySrc()];
say("51", "a barrel with export { x } from", () => { const before = all(); const spies = [spyOn(named, "add").mockImplementation(() => 100), spyOn(named, "twice").mockImplementation(() => 200), spyOn(named, "inner").mockImplementation(() => "spied")]; const during = all(); const calls = spies.map(s => s.mock.calls.length); spies.forEach(s => s.mockRestore()); return [before, during, calls, all()]; });
