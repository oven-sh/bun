// Regenerates `*.turndown.md` next to each `*.html` fixture: the reference
// output of turndown@7.2.4 + turndown-plugin-gfm@1.0.2 configured with the
// same spellings as Bun.markdown.fromHTML's defaults. md-from-html.test.ts
// compares against these files so the (slow under debug builds) JS converter
// does not have to run over whole pages at test time.
//
//   bun test/js/bun/md/fixtures/regenerate-turndown.mjs
import { readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

const dir = import.meta.dir;
for (const name of readdirSync(dir)) {
  if (!name.endsWith(".html")) continue;
  const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-", hr: "---" });
  td.use(gfm);
  td.remove(["script", "style", "noscript", "template", "title", "head"]);
  const out = td.turndown(readFileSync(join(dir, name), "utf8"));
  writeFileSync(join(dir, name.replace(/\.html$/, ".turndown.md")), out + "\n");
  console.log(name, "->", out.length, "chars");
}
