// Bun.diff
const patch = Bun.diff.createPatch("a\nb\n", "a\nc\n", { oldFileName: "file.txt" });
console.log(patch);
console.log(JSON.stringify(Bun.diff.parsePatch(patch)), JSON.stringify(Bun.diff.applyPatch("a\nb\n", patch)));
console.log(JSON.stringify(Bun.diff.words("a b", "a c")), JSON.stringify(Bun.diff.arrays([1, 2], [2, 3])));
