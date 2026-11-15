import { Glob } from "bun";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// How much memory `bun_png` asks for is up to a file or a caller, so a refusal is an error there and not the end of the
// process, which is what the calls named below make of it. Ask with `try_reserve()` or `try_reserve_exact()`.
//
// What fills a `Vec` (`push()`, `extend()`, `resize()`) is invisible to this lint. It aborts in the same way once it
// leaves the room that was reserved.
test("bun_png does not ask for memory in a way that aborts when it is refused", async () => {
  const crate = path.resolve(import.meta.dir, "..", "..", "..", "src", "png");
  const functions = `
    with_capacity reserve reserve_exact shrink_to shrink_to_fit into_boxed_slice to_vec to_owned into_owned to_string
    clone cloned clone_from collect from_iter concat split_off sort sort_by sort_by_key sort_by_cached_key
    unwrap_or_oom handle_oom out_of_memory
  `;
  const aborts = new RegExp(
    [
      String.raw`(?:\.|::)(?:${functions.trim().split(/\s+/).join("|")})\b`,
      String.raw`\b(?:vec|format)!`,
      String.raw`\b(?:Box|Rc|Arc)::(?:<.*?>::)?(?:new\w*|from)\b`,
      String.raw`\b(?:Vec|String)::(?:<.*?>::)?from\b`,
    ].join("|"),
  );
  expect("out.shrink_to_fit();").toMatch(aborts);

  const found: string[] = [];
  let scanned = 0;
  for await (const file of new Glob("**/*.rs").scan({ cwd: crate })) {
    scanned++;
    readFileSync(path.join(crate, file), "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (aborts.test(line.replace(/\/\/.*/, ""))) found.push(`src/png/${file}:${i + 1}: ${line.trim()}`);
      });
  }
  expect(scanned).toBeGreaterThan(0);
  expect(found.sort()).toEqual([]);
});
