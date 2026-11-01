import { spyOn } from "bun:test";
import * as pkg from "pkg-esm";
import main, { add, callsAdd, Maker } from "pkg-esm";
import { seenBySrc } from "../src/spies/uses";
import { say } from "../src/spies/say";
const all = () => [pkg.add(1, 2), add(1, 2), callsAdd(1, 2), pkg.default(), main(), Maker.make(), pkg.inner(), pkg.callsInner(), seenBySrc()];
say("53", "the namespace of the package", () => { const before = all(); const spies = [spyOn(pkg, "add").mockImplementation(() => 100), spyOn(pkg, "default").mockImplementation(() => "spied main"), spyOn(Maker, "make").mockImplementation(() => "spied made"), spyOn(pkg, "inner").mockImplementation(() => "spied inner")]; const during = all(); spies.forEach(s => s.mockRestore()); return [before, during, all()]; });
