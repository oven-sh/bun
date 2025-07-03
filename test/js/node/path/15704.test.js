import assert from "assert";
import path from "path";

test("too-long path names do not crash when joined", () => {
  const length = 4096;
  const tooLengthyFolderName = Array.from({ length }).fill("b").join("");
  assert.equal(path.join(tooLengthyFolderName), "b".repeat(length));
  assert.equal(path.win32.join(tooLengthyFolderName), "b".repeat(length));
  assert.equal(path.posix.join(tooLengthyFolderName), "b".repeat(length));
});
