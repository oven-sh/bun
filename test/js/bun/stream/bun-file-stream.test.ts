import { openSync, closeSync } from "fs";
import { tempDirWithFiles } from "../../../harness";

// describe("BunFile#stream()", () => {
//   test("does not keep event loop open if nothing is being read", () => {
//     const t = tempDirWithFiles("bun-file-stream", {
//       "index.ts": `
//         Bun.file(require('fs').openSync())
//       `,
//     });
//   });
// });

test("BunFile cache it's .stream() when given a file descriptor.", x => {
  const stream1 = Bun.stdin.stream();
  const stream2 = Bun.stdin.stream();
  expect(stream1 === stream2).toBeTrue();

  const fd = openSync(import.meta.path, "r");
  try {
    expect(Bun.file(fd) === Bun.file(fd)).toBeTrue();
  } finally {
    closeSync(fd);
  }
});
