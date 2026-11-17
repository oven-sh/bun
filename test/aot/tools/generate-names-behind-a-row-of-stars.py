#!/usr/bin/env python3
"""generate-names-behind-a-row-of-stars.py <folder>: writes the programs of parallel/names-behind-a-row-of-stars. The same bytes every time.
A row of ES modules: m0 exports v0 and f0, and each further one says `export * from` the one before and exports a variable and a function of its own. The table of a file has a place for a name that a star
brings it only where somebody may ask the file for the name. Each program is a folder with the row and ONE way to ask the last file of the row, or one in the middle, for names: an entry of `askers`."""
import os, sys
out = sys.argv[1]
LAST = 8

def row(extra=None):
    files = {'m0.mjs': 'export const v0 = "v0";\nexport function f0() { return this === undefined ? "f0" : Object.keys(this).length; }\n'}
    for k in range(1, LAST + 1):
        files[f'm{k}.mjs'] = f'export * from "./m{k - 1}.mjs";\nexport const v{k} = "v{k}";\nexport function f{k}() {{ return this === undefined ? "f{k}" : Object.keys(this).length; }}\n'
    files.update(extra or {})
    return files

top = f'./m{LAST}.mjs'
SPACE = 'export let tell = function () { return Object.keys(this).join() + " " + this.other; };\nexport const other = "other";\n'
askers = {
    'two-names-read-off-the-namespace': ('Two names are read off the namespace object, and nothing else is done with it.', 'main.mjs',
        f'import * as all from "{top}";\nconsole.log(all.v0 + all.v{LAST}, all.v5);\n', None),
    'names-imported': ('Names are imported.', 'main.mjs',
        f'import {{ v0, v7 as seven, f3 }} from "{top}";\nconsole.log(v0, seven, f3());\n', None),
    'a-name-that-nobody-has-read-off-the-namespace': ('A name that no file of the row has is read off the namespace object.', 'main.mjs',
        f'import * as all from "{top}";\nconsole.log(all.missing === undefined, all.v1, all.default === undefined, all.then === undefined);\n', None),
    'the-namespace-is-listed': ('The namespace object is listed.', 'main.mjs',
        f'import * as all from "{top}";\nconsole.log(Object.keys(all).join());\n', None),
    'the-namespace-goes-to-a-function': ('The namespace object is handed to a function.', 'main.mjs',
        f'import * as all from "{top}";\nconst read = (from, name) => from[name];\nconsole.log(read(all, "v2"), read(all, "v" + 7), read(all, "missing") === undefined);\n', None),
    'a-computed-name': ('A name that is computed is read off the namespace object.', 'main.mjs',
        f'import * as all from "{top}";\nlet text = "";\nfor (let k = 0; k <= {LAST}; k += 4) text += all["v" + k];\nconsole.log(text);\n', None),
    'a-written-name-in-brackets': ('A name is written in brackets.', 'main.mjs',
        f'import * as all from "{top}";\nconsole.log(all["v4"], all[`v6`]);\n', None),
    'a-pattern': ('The namespace object is taken apart by a pattern.', 'main.mjs',
        f'import * as all from "{top}";\nconst {{ v0, v8, missing = "none", ...rest }} = all;\nconsole.log(v0, v8, missing, Object.keys(rest).length);\n', None),
    'a-member-is-called': ('A function is called through the namespace object, which it finds in `this`.', 'main.mjs',
        f'import * as all from "{top}";\nconsole.log(all.f2(), all.f{LAST}(), (0, all.f1)());\n', None),
    'a-member-is-stored-to-and-deleted': ('A store to a member of a namespace object and a deletion of one are refused.', 'main.mjs',
        f'import * as all from "{top}";\nconsole.log(Reflect.set(all, "v3", 1), Reflect.deleteProperty(all, "v3"), Reflect.deleteProperty(all, "missing"), all.v3);\n', None),
    'asked-whether-it-has-names': ('The namespace object is asked whether it has names.', 'main.mjs',
        f'import * as all from "{top}";\nconsole.log("v0" in all, "missing" in all, Object.hasOwn(all, "v{LAST}"), Reflect.has(all, "f6"), typeof all.v2, typeof all.nothing);\n', None),
    'only-tested': ('The namespace object is only tested.', 'main.mjs',
        f'import * as all from "{top}";\nconsole.log(all ? "there" : "not there", !all, all != null, all.v1);\n', None),
    'seen-by-eval': ('A direct eval sees the name of the namespace object.', 'main.mjs',
        f'import * as all from "{top}";\nconsole.log(all.v1, eval("all.v" + 3));\n', None),
    'named-in-the-text-of-an-eval-alone': ('Only the text of a direct eval names the namespace object.', 'main.mjs',
        f'import * as all from "{top}";\nconsole.log(eval("all.v" + 3), (() => eval("Object.keys(all).length"))());\n', None),
    'exported-again-by-name': ('A file exports names of the row again, one of them under another name.', 'main.mjs',
        'import { v0, ten, f4 } from "./again.mjs";\nconsole.log(v0, ten, f4());\n', {'again.mjs': f'export {{ v0, v7 as ten, f4 }} from "{top}";\n'}),
    'imported-and-exported': ('A file imports names of the row and exports them.', 'main.mjs',
        'import { v1, f5 } from "./again.mjs";\nconsole.log(v1, f5());\n', {'again.mjs': f'import {{ v1, f5 }} from "{top}";\nexport {{ v1, f5 }};\n'}),
    'exported-as-a-namespace': ('A file exports the row as a namespace, and names are read off that.', 'main.mjs',
        'import { inner } from "./holder.mjs";\nimport * as holder from "./holder.mjs";\nconsole.log(inner.v0, holder.inner.v7, Object.keys(holder).join(), Object.keys(inner).length);\n', {'holder.mjs': f'export * as inner from "{top}";\n'}),
    'a-namespace-imported-and-exported': ('A file imports the namespace object of the row and exports it.', 'main.mjs',
        'import { all } from "./holder.mjs";\nconsole.log(all.v0, all.v6, all.missing === undefined);\n', {'holder.mjs': f'import * as all from "{top}";\nexport {{ all }};\n'}),
    'imported-by-a-call': ('The row is imported by a call, and names are read off what it answers.', 'main.mjs',
        f'console.log((await import("{top}")).v0);\nconst {{ v8, f1 }} = await import("{top}");\nconst all = await import("./m6.mjs");\nconsole.log(v8, f1(), Object.keys(all).length, all.v7 === undefined);\n', None),
    'imported-by-a-call-under-a-computed-name': ('A file of the row is imported under a name that is computed.', 'main.mjs',
        'const pick = (k) => import(`./m${k}.mjs`);\nconst all = await pick(JSON.parse("5"));\nconsole.log(all.v0, all.v5, all.v6 === undefined, Object.keys(all).length);\n', None),
    'required': ('A CommonJS file requires the row.', 'main.cjs',
        f'const all = require("{top}");\nconst {{ v2 }} = require("./m4.mjs");\nconsole.log(all.v0, all.v{LAST}, v2, require("./m3.mjs").f0(), Object.keys(require("./m2.mjs")).join());\n', None),
    'the-middle-is-asked-too': ('The last file and one in the middle are asked for names.', 'main.mjs',
        f'import * as all from "{top}";\nimport * as middle from "./m6.mjs";\nimport {{ v2 }} from "./m3.mjs";\nconsole.log(all.v0, middle.v1, middle.v6, middle.v7 === undefined, v2);\n', None),
    'a-local-name-goes-before-a-star': ('A file of the row exports a name of its own that a file before it has too.', 'main.mjs',
        'import * as all from "./over.mjs";\nimport { v3 } from "./over.mjs";\nconsole.log(all.v3, v3, all.v2);\n', {'over.mjs': f'export * from "{top}";\nexport const v3 = "v3 of the last file";\n'}),
    'two-stars-bring-one-name': ('Two stars bring a file one name from two files: it has none of that name. What both bring from one file it has.', 'main.mjs',
        'import * as both from "./both.mjs";\nconsole.log(both.shared === undefined, "shared" in both, both.v0, both.other, Object.keys(both).length);\n',
        {'both.mjs': f'export * from "{top}";\nexport * from "./other.mjs";\nexport * from "./m4.mjs";\n', 'other.mjs': 'export const other = "other";\nexport const shared = 1;\n', 'm1.mjs': 'export * from "./m0.mjs";\nexport const v1 = "v1";\nexport function f1() { return "f1"; }\nexport const shared = 2;\n'}),
    'stars-in-a-ring': ('The first file of the row has a star over the last.', 'main.mjs',
        f'import * as all from "./m5.mjs";\nimport {{ v{LAST} as last }} from "./m0.mjs";\nconsole.log(all.v0, all.v{LAST}, all.v5, last);\n', {'m0.mjs': f'export * from "{top}";\nexport const v0 = "v0";\nexport function f0() {{ return "f0"; }}\n'}),
    'a-commonjs-file-at-the-start': ('The row starts at a CommonJS file: what that exports shows when it has run.', 'main.mjs',
        f'import * as all from "{top}";\nimport {{ fromCommonJs }} from "{top}";\nconsole.log(all.fromCommonJs, fromCommonJs, all.v1, all.missing === undefined);\n', {'m0.mjs': 'export * from "./start.cjs";\nexport const v0 = "v0";\nexport function f0() { return "f0"; }\n', 'start.cjs': 'exports.fromCommonJs = "from the CommonJS file";\n'}),
    'a-name-of-a-built-in-module-in-the-row': ('A file of the row exports a name of a built-in module again.', 'main.mjs',
        f'import * as all from "{top}";\nconsole.log(typeof all.sep, all.v0, typeof all.basename);\n', {'m0.mjs': 'export { sep, basename } from "node:path";\nexport const v0 = "v0";\nexport function f0() { return "f0"; }\n'}),
    'each-file-runs': ('Each file of the row runs, in its order, whoever asks for what.', 'main.mjs',
        f'import {{ v0 }} from "{top}";\nconsole.log(v0, globalThis.ran.join());\n',
        {f'm{k}.mjs': (f'export * from "./m{k - 1}.mjs";\n' if k else '') + f'export const v{k} = "v{k}";\n(globalThis.ran ??= []).push({k});\n' for k in range(LAST + 1)}),
    'a-package-without-side-effects': ('The row lies in a package that says that nothing is lost without its files: the files that have the names run all the same.', 'main.mjs',
        'import { v0, v3 } from "./a-row/m%d.mjs";\nimport * as all from "./a-row/m%d.mjs";\nconsole.log(v0, v3, all.v1);\n' % (LAST, LAST),
        {**{f'a-row/m{k}.mjs': (f'export * from "./m{k - 1}.mjs";\n' if k else '') + f'export const v{k} = ["v", {k}].join("");\n' for k in range(LAST + 1)},
         'a-row/package.json': '{ "name": "a-row", "version": "1.0.0", "type": "module", "sideEffects": false }\n'}),
    'typed': ('The row is TypeScript, with types among its exports.', 'main.ts',
        'import * as all from "./t3";\nimport { type Shape, v0 } from "./t3";\nconst shape: Shape = { side: 2 };\nconst one: all.Shape = { side: 3 };\nconsole.log(all.v0 + all.v3, v0, shape.side + one.side, all.Kind.Round);\n',
        {'t0.ts': 'export const v0 = "v0";\nexport interface Shape { side: number }\nexport enum Kind { Round, Flat }\n', **{f't{k}.ts': f'export * from "./t{k - 1}";\nexport const v{k} = "v{k}";\n' for k in range(1, 4)}}),
    'an-alias-of-a-member': ('`import v = all.v2` reads the name off the object.', 'main.ts',
        'import * as all from "./t3";\nimport two = all.v2;\nconsole.log(two, all.v0);\n',
        {'t0.ts': 'export const v0 = "v0";\n', **{f't{k}.ts': f'export * from "./t{k - 1}";\nexport const v{k} = "v{k}";\n' for k in range(1, 4)}}),
    'called-through-a-namespace-that-the-row-exports': ('A file over the row exports a namespace too, and a function is called through that: it finds the other module in `this`, not the file that the name is imported from.', 'main.mjs',
        'import { inner } from "./over.mjs";\nconsole.log(inner.tell(), inner.other);\n',
        {'over.mjs': f'export * from "{top}";\nexport * as inner from "./space.mjs";\n', 'space.mjs': SPACE}),
    'called-through-a-namespace-that-a-star-brings': ('A star brings the name of a namespace, under which a function is called.', 'main.mjs',
        'import { inner, again } from "./over.mjs";\nconsole.log(inner.tell(), again.tell``);\n',
        {'over.mjs': f'export * from "{top}";\nexport * from "./holder.mjs";\n', 'holder.mjs': 'import * as inner from "./space.mjs";\nexport { inner };\nexport { inner as again } from "./holder.mjs";\n', 'space.mjs': SPACE}),
    'called-through-a-namespace-in-a-namespace': ('A function is called through a namespace that is read off a namespace. A file of the row defines it, and another file hands it on by its name.', 'main.mjs',
        'import * as outer from "./outer.mjs";\nconsole.log(outer.inner.f5(), outer.inner.other);\n',
        {'outer.mjs': 'export * as inner from "./hands-on.mjs";\n', 'hands-on.mjs': 'export { f5 } from "./m5.mjs";\nexport const other = "other";\n'}),
    'an-object-that-the-row-hands-on-by-name': ('A file over the row hands an object on by its name, and a method of it is called.', 'main.mjs',
        'import { tool, v2 } from "./over.mjs";\nconsole.log(tool.tell(), v2);\n',
        {'over.mjs': f'export * from "{top}";\nexport {{ tool }} from "./tool.mjs";\n', 'tool.mjs': 'export const tool = { told: "told", tell() { return this.told; } };\n'}),
}
count = 0
for name, (what, entry, text, extra) in askers.items():
    files = row(extra) if not (extra and ('t0.ts' in extra or 'a-row/package.json' in extra)) else dict(extra)
    files[entry] = f'// {what}\n' + text
    for path, content in files.items():
        path = os.path.join(out, name, path); os.makedirs(os.path.dirname(path), exist_ok=True); open(path, 'w').write(content); count += 1
print(len(askers), 'programs,', count, 'files')
