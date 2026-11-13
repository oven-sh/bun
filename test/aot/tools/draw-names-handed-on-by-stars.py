#!/usr/bin/env python3
"""draw-names-handed-on-by-stars.py <folder> <first seed> <count> | <folder> <seed>,<seed>,..: draws programs, each a folder `drawn-<seed>` with a main.js.
ES modules hand names on with `export *`, `export * as`, `export { a as b } from` and by importing and exporting, also in rings, and main.js and functions of the modules ask for them in many ways: by name,
off namespace objects, off namespace objects under names, by calls through them of functions that list what they find in `this`, by `import()`. The reference is `bun main.js`.
parallel/names-handed-on-in-drawn-ways holds the 13 of the seeds 1000 to 1095 at which a build stopped while the export tables left out names of a file that the reach looks at."""
import itertools
import os
import random
import sys

AMBIGUOUS = "ambiguous"


class File:
    def __init__(self, index):
        self.index = index
        self.name = f"part{index}"
        self.locals = {}  # exported name -> text of the statement
        self.indirect = {}  # exported name -> (target, imported name), or (target, None) for a namespace
        self.stars = []
        self.lines = []


def resolve(files, file, name, seen):
    if (file.index, name) in seen:
        return None
    seen = seen | {(file.index, name)}
    if name in file.locals:
        return ("variable", file.index, name)
    if name in file.indirect:
        target, imported = file.indirect[name]
        if imported is None:
            return ("namespace", target)
        return resolve(files, files[target], imported, seen)
    if name == "default":
        return None
    found = None
    for target in file.stars:
        answer = resolve(files, files[target], name, seen)
        if answer == AMBIGUOUS:
            return AMBIGUOUS
        if answer is None:
            continue
        if found is None:
            found = answer
        elif found != answer:
            return AMBIGUOUS
    return found


def exported_names(files, file, seen):
    if file.index in seen:
        return []
    seen = seen | {file.index}
    names = list(file.locals) + list(file.indirect)
    for target in file.stars:
        for name in exported_names(files, files[target], seen):
            if name != "default" and name not in names:
                names.append(name)
    return names


def good_names(files, file):
    answers = {}
    for name in exported_names(files, file, frozenset()):
        answer = resolve(files, file, name, frozenset())
        if answer is not None and answer != AMBIGUOUS:
            answers[name] = answer
    return answers


def draw(seed):
    rng = random.Random(seed)
    count = rng.randint(3, 9)
    files = [File(index) for index in range(count)]
    pool = [f"n{index}" for index in range(rng.randint(3, 8))]
    for file in files:
        index = file.index
        for _ in range(rng.randint(0, 3)):
            name = rng.choice(pool) if rng.random() < 0.5 else f"own{index}_{len(file.locals)}"
            if name in file.locals:
                continue
            kind = rng.choice([0, 1, 2, 2, 2, 3, 4])
            told = f"{name}@{file.name}"
            if kind == 0:
                file.locals[name] = f'export const {name} = "{told}";'
            elif kind == 1:
                file.locals[name] = f'export function {name}() {{ return "{told}()"; }}'
            elif kind == 2:
                file.locals[name] = (
                    f"export let {name} = function () {{ return \"{told} on \" + (this === undefined ? \"nothing\" : Object.keys(this).join(\"+\")); }};"
                )
            elif kind == 3:
                file.locals[name] = f'const inner_{name} = {{ told: "{told}", tell() {{ return this.told; }} }};\nexport {{ inner_{name} as {name} }};'
            else:
                file.locals[name] = f'export class {name} {{ static tell() {{ return "{told} " + this.name; }} }}'
        if rng.random() < 0.15:
            file.locals["default"] = f'export default "default@{file.name}";'
    for file in files:
        index = file.index
        others = [other for other in range(count) if other != index]
        lower = [other for other in others if other < index] or others
        for _ in range(rng.choice([0, 1, 1, 1, 2, 2, 3])):
            target = rng.choice(lower if rng.random() < 0.85 else others)
            if target not in file.stars:
                file.stars.append(target)
    for file in files:
        index = file.index
        others = [other for other in range(count) if other != index]
        lower = [other for other in others if other < index] or others
        for step in range(rng.choice([0, 1, 1, 2, 2, 3])):
            target = rng.choice(lower if rng.random() < 0.85 else others)
            kind = rng.choice([0, 0, 1, 1, 2, 3, 4, 5])
            if kind <= 1:
                name = rng.choice([f"space{index}_{step}", rng.choice(pool), "space"])
                if name in file.locals or name in file.indirect:
                    continue
                file.indirect[name] = (target, None)
                if kind == 0:
                    file.lines.append(f'export * as {name} from "./{files[target].name}.js";')
                else:
                    file.lines.append(f'import * as held_{name} from "./{files[target].name}.js";\nexport {{ held_{name} as {name} }};')
                continue
            known = good_names(files, files[target])
            if not known:
                continue
            imported = rng.choice(sorted(known))
            name = imported if kind <= 3 else rng.choice([f"again{index}_{step}", rng.choice(pool)])
            if name in file.locals or name in file.indirect:
                continue
            file.indirect[name] = (target, imported)
            if resolve(files, file, name, frozenset()) in (None, AMBIGUOUS):
                del file.indirect[name]
                continue
            if kind % 2 == 0:
                file.lines.append(f'export {{ {imported} as {name} }} from "./{files[target].name}.js";')
            else:
                file.lines.append(f'import {{ {imported} as taken_{step}_{name} }} from "./{files[target].name}.js";\nexport {{ taken_{step}_{name} as {name} }};')
    # A later entry may have made an earlier one ambiguous or circular: such a program does not link, and the draw is thrown away.
    for file in files:
        for name, (target, imported) in file.indirect.items():
            if imported is not None and resolve(files, file, name, frozenset()) in (None, AMBIGUOUS):
                return None

    def show(expression):
        return (
            f"try {{ console.log({expression!r}, String({expression})); }} catch (error) {{ console.log({expression!r}, \"threw\", error.constructor.name); }}"
        )

    def uses_of(holder, answer, depth):
        # What to do with an expression that holds what `answer` says.
        if answer[0] == "namespace":
            inner = good_names(files, files[answer[1]])
            lines = []
            way = rng.randrange(7)
            if way == 0:
                lines.append(show(f"Object.keys({holder}).join()"))
            elif way == 1 and inner:
                lines.append(show(f"{holder}[{rng.choice(sorted(inner))!r}.slice(0)] !== undefined"))
            elif way == 2:
                lines.append(show(f"typeof {holder}.missing"))
            if inner and depth < 3:
                for name in rng.sample(sorted(inner), min(len(inner), rng.randint(1, 2))):
                    lines += uses_of(f"{holder}.{name}", inner[name], depth + 1)
            return lines
        _, owner, name = answer
        text = files[owner].locals[name]
        if text.startswith("export const") or text.startswith("export default"):
            return [show(holder)]
        if text.startswith("export function") or text.startswith("export let"):
            return [show(f"{holder}()") if rng.random() < 0.9 else show(f"typeof {holder}")]
        return [show(f"{holder}.tell()") if rng.random() < 0.8 else show(f"typeof {holder}")]

    def user(text_name, importer_index):
        lines, body = [], []
        for step in range(rng.randint(2, 6)):
            target = rng.randrange(count)
            if target == importer_index:
                continue
            path = f"./{files[target].name}.js"
            known = good_names(files, files[target])
            way = rng.randrange(10)
            if way <= 3 and known:
                spaces = sorted(name for name in known if known[name][0] == "namespace")
                name = rng.choice(spaces) if spaces and rng.random() < 0.6 else rng.choice(sorted(known))
                local = f"{text_name}_{step}"
                lines.append(f'import {{ {name} as {local} }} from "{path}";')
                body += uses_of(local, known[name], 0)
            elif way <= 7:
                local = f"{text_name}_all_{step}"
                lines.append(f'import * as {local} from "{path}";')
                body += uses_of(local, ("namespace", target), 0)
            elif way == 8:
                body.append(f'console.log("import()", Object.keys(await import("{path}")).join());')
            else:
                lines.append(f'import "{path}";')
        return lines, body

    main_lines, main_body = user("main", -1)
    texts = {}
    for file in files:
        lines = [f'export * from "./{files[target].name}.js";' for target in file.stars]
        lines += file.lines + list(file.locals.values())
        if rng.random() < 0.25:
            imports, body = user(f"in{file.index}", file.index)
            body = [line for line in body if "await" not in line]
            lines = imports + lines
            lines.append(f"export function use{file.index}() {{\n  " + "\n  ".join(body) + "\n}")
            main_lines.append(f'import {{ use{file.index} }} from "./{file.name}.js";')
            main_body.append(f"use{file.index}();")
        texts[f"{file.name}.js"] = "\n".join(lines) + "\n"
    head = f"// Drawn by test/aot/tools/draw-names-handed-on-by-stars.py, seed {seed}."
    texts["main.js"] = "\n".join([head] + main_lines + main_body) + "\n"
    return texts


def main():
    folder = sys.argv[1]
    if len(sys.argv) == 3:
        seeds = iter([int(seed) for seed in sys.argv[2].split(",")])
        count = sys.argv[2].count(",") + 1
    else:
        seeds, count = itertools.count(int(sys.argv[2])), int(sys.argv[3])
    made = 0
    while made < count:
        seed = next(seeds)
        texts = draw(seed)
        if texts is None:
            continue
        where = os.path.join(folder, f"drawn-{seed}")
        os.makedirs(where, exist_ok=True)
        for name, text in texts.items():
            with open(os.path.join(where, name), "w") as out:
                out.write(text)
        made += 1
    print(f"{made} programs, the last of seed {seed}")


main()
