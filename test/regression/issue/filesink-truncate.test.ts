// FileSink should truncate existing files when opening with writer()

import { expect, test } from "bun:test";
import { tempDir } from "harness";
import { join } from "path";

test("writer() should truncate existing file when writing shorter content", async () => {
  using dir = tempDir("filesink-truncate", {});
  const path = join(dir, "truncate-test.txt");

  await Bun.write(path, "Long content");

  const writer = Bun.file(path).writer();
  writer.write("Short");
  await writer.end();

  // should be "Short" not "Shortcontent"
  const content = await Bun.file(path).text();
  expect(content).toBe("Short");
});
