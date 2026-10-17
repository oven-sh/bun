#!/usr/bin/env python3
"""modules-failing-first-evaluation.py <folder>: ONE CASE A FOLDER: A CommonJS module whose FIRST evaluation fails: (1) at the stack's end (the RangeError comes at the entry, before the first exports object is made), six forms of the module; (2) by a throw inside its body, five forms.
`bun run` evaluates such a module again at the next require(), and so does an executable built with --aot. One built without it evaluates the module once: later require()s read what had been exported by then, at the least the empty {} that the bundler's wrapper makes ahead of the call."""
import os, sys
out = sys.argv[1]; cases = {}
END = '''function lazy() { return require("./lib"); }
function dive(n) { try { return dive(n + 1); } catch (e) { return lazy(); } }
let first; try { first = dive(0); } catch (e) { first = "threw " + e.name; }
let k; try { k = lazy(); } catch (e) { k = "threw " + e.name; }
console.log(typeof first, typeof k, k && typeof k === "object" ? Object.keys(k).join() : String(k), first === k);
let again; try { again = lazy(); } catch (e) { again = "threw " + e.name; } console.log(again === k, typeof again);
'''
LIBS = {
    "only-values": "'use strict'\nconst keys = { kState: Symbol('state'), kOptions: Symbol('options') }\nmodule.exports = keys\n",
    "a-function-too": "'use strict'\nlet n = 0\nfunction f() { return n++ }\nmodule.exports = { f, kState: Symbol('state') }\n",
    "exports-dot": "'use strict'\nexports.kState = Symbol('state')\nexports.kOptions = Symbol('options')\n",
    "a-side-effect": "'use strict'\nglobalThis.loads = (globalThis.loads || 0) + 1\nmodule.exports = { kState: Symbol('state'), loads: globalThis.loads }\n",
    "a-class": "'use strict'\nclass Box { constructor(v) { this.v = v } }\nmodule.exports = { Box, kState: Symbol('state') }\n",
}
for name, lib in LIBS.items():
    cases["at-the-stacks-end-" + name] = {"main.js": END, "lib.js": lib}
cases["at-the-stacks-end-it-requires-another"] = {"main.js": END, "lib.js": "'use strict'\nconst other = require('./other')\nmodule.exports = { kState: Symbol('state'), other }\n", "other.js": "'use strict'\nmodule.exports = { kOther: Symbol('other') }\n"}
THROW = '''const get = () => { try { return require("./lib"); } catch (e) { return "threw " + e.message; } };
const show = v => typeof v + " " + (v && typeof v === "object" ? JSON.stringify(v) : String(v));
const a = get(), b = get(), c = get(); console.log(show(a)); console.log(show(b)); console.log(show(c), b === c);
'''
BODIES = {
    "at-its-first-statement": "throw new Error('first')\nmodule.exports = { a: 1 }\n",
    "before-module-exports-is-stored": "const made = { a: 1 }\nif (made.a) throw new Error('first')\nmodule.exports = made\n",
    "after-exports-dot": "exports.a = 1\nthrow new Error('first')\n",
    "after-module-exports-is-stored": "module.exports = { a: 1 }\nthrow new Error('first')\n",
    "in-a-function-it-calls": "function check() { throw new Error('first') }\ncheck()\nmodule.exports = { a: 1 }\n",
}
for name, lib in BODIES.items():
    cases["it-throws-" + name] = {"main.js": THROW, "lib.js": lib}
for name, files in cases.items():
    os.makedirs(os.path.join(out, name), exist_ok=True)
    for f, text in files.items():
        open(os.path.join(out, name, f), "w").write(text)
print(len(cases), "cases")
