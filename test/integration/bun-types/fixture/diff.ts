import { diff } from "bun";
import { expectType } from "./utilities";

expectType(diff.lines("a", "b")).is<Bun.diff.Change[]>();
expectType(diff.words("a", "b", {})).is<Bun.diff.Change[]>();
expectType(diff.chars("a", "b", { maxEditLength: 1 })).is<Bun.diff.Change[] | undefined>();
expectType(diff.arrays([1], [2] as readonly number[])).is<Bun.diff.Change<number[]>[]>();
expectType(diff.arrays([1], [2], { maxEditLength: 1 })).is<Bun.diff.Change<number[]>[] | undefined>();
expectType(diff.hunks("a", "b", { context: 0 })).is<Bun.diff.Hunk[]>();
expectType(diff.createPatch("a", "b", { oldFileName: "a.txt" })).is<string>();
expectType(diff.createPatch("a", "b", {} as Bun.diff.PatchOptions)).is<string | undefined>();
expectType(diff.lines("a", "b", { ignoreCase: true, ignoreWhitespace: true, stripTrailingCr: true })).is<
  Bun.diff.Change[]
>();
expectType(diff.chars("a", "b", { ignoreCase: true })).is<Bun.diff.Change[]>();
expectType(diff.createPatch("a", "b", { ignoreWhitespace: true })).is<string>();
expectType(diff.parsePatch("")).is<Bun.diff.FilePatch[]>();
expectType(diff.applyPatch("a", "")).is<string>();
expectType(diff.applyPatch("a", diff.parsePatch("")[0]!)).is<string>();
expectType(diff.applyPatch("a", diff.hunks("a", "b"))).is<string>();
expectType(diff.applyPatch("a", [{ oldStart: 1, lines: ["-a"] }])).is<string>();

// @ts-expect-error
diff.lines("a", "b", { context: 1 });
// @ts-expect-error
diff.words("a", "b", { ignoreWhitespace: true });
// @ts-expect-error
diff.arrays([], [], { ignoreCase: true });
// @ts-expect-error
diff.lines(1, 2);
// @ts-expect-error
diff.applyPatch("a", diff.parsePatch(""));
