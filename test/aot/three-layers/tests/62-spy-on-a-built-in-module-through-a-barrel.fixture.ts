import { spyOn } from "bun:test";
import * as ns from "../src/spies/barrel-of-library.js";
import { underTest } from "../src/spies/calls-the-reader.js";
import { createHash as direct } from "node:crypto";
import { say } from "../src/spies/say";
const fake = () => ({ update() { return this; }, digest() { return "spied-digest"; } });
const all = () => [underTest("x"), ns.createHash("sha1").update("x").digest("hex").slice(0, 8), direct("sha1").update("x").digest("hex").slice(0, 8), require("crypto").createHash("sha1").update("x").digest("hex").slice(0, 8)];
say("62", "a barrel that imports names of a built-in module and exports them", () => { const before = all(); let during; { using spy = spyOn(ns, "createHash").mockImplementation(fake as any); during = [all(), spy.mock.calls.length]; } return [before, during, all()]; });
say("62", "another name of it, restored by hand", () => { const spy = spyOn(ns, "randomBytes").mockImplementation((() => ({ length: 99 })) as any); const during = all(); spy.mockRestore(); return [during, all()]; });
