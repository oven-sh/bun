// Six everyday shapes of a load whose name comes from outside the program, told over eight modules of node. The build cannot know the name. The executable loads the module and uses it as plain Bun does, or
// refuses the load by the error that the page documents; it does not hand out a module of which a part is missing.
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const uses: Record<string, string> = {
  fs: `m.existsSync("/")`,
  path: `m.join("a", "b")`,
  os: `typeof m.platform()`,
  util: `m.format("%s-%d", "a", 1)`,
  url: `m.fileURLToPath("file:///made/up")`,
  crypto: `m.createHash("sha1").update("a").digest("hex").slice(0, 8)`,
  events: `(() => { const e = new m.EventEmitter(); let n = 0; e.on("x", () => n++); e.emit("x"); return n; })()`,
  stream: `typeof new m.PassThrough().write`,
};
const says = `function say(m) { try { console.log("loaded", typeof m, m === null ? "null" : Object.keys(m).length > 3); console.log("used", USE); } catch (error) { console.log("use threw", error?.code, String(error?.message).slice(0, 200)); } }
function refused(error) { console.log("load threw", error?.name, error?.code, String(error?.message).slice(0, 200)); }
`;
const shapes: Record<string, string> = {
  "a-require-of-a-prefix-and-a-name.cjs": `const name = process.argv[2];
try { say(require("node:" + name)); } catch (error) { refused(error); }
`,
  "b-import-that-may-fail.mjs": `const optional = "node:" + process.argv[2];
const m = await import(optional).catch(() => null);
if (m === null) console.log("the import answered null"); else say(m.default ?? m);
`,
  "c-require-in-a-try.cjs": `const name = process.argv[2];
let m; try { m = require(name); } catch {}
if (m === undefined) console.log("nothing was loaded"); else say(m);
`,
  "d-module-require.cjs": `const name = process.argv[2];
try { say(module.require(name)); } catch (error) { refused(error); }
`,
  "e-get-builtin-module.mjs": `const name = process.argv[2];
try { const m = process.getBuiltinModule(name); if (m === undefined) console.log("undefined"); else say(m); } catch (error) { refused(error); }
`,
  "f-a-made-require.mjs": `import { createRequire } from "node:module";
const name = process.argv[2];
try { say(createRequire(import.meta.url)(name)); } catch (error) { refused(error); }
`,
};
// Two of the shapes swallow the error, as such code does: what they print then stands for the refusal.
const head = (module: string) =>
  `// Arguments: ${module}\n// Refused: Cannot load '\n// Refused: the import answered null\n// Refused: nothing was loaded\n`;

export default function write(folder: string) {
  for (const [shape, text] of Object.entries(shapes))
    for (const [module, use] of Object.entries(uses))
      writeFileSync(join(folder, shape.replace(".", `--${module}.`)), head(module) + says.replace("USE", use) + text);
}
