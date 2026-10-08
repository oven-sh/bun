#!/usr/bin/env python3
"""What `src/format/css/memo.rs` keeps must not show in the output: the result for a file must not depend on the files before it.

    python3 css-memo-orders.py <bun-lint> <bun-lint without the memo> <directory in memory> <directories with style sheets..>

One thread formats all style sheets in three shuffled orders, and once without the memo. That is done for two sets of options. In the
second, `overrides` give every other file other quotes, another width and no trailing commas. The four results have to be the same, byte
for byte. The style sheets should include what `mutations.ts` makes.

The binary without the memo: in `Printer::print_sequence` of `src/format/css/printer.rs`, put `None` in the place of
`self.memo_context(scope)`, build, and take the change back.

Only one copy of the inputs exists at a time, and only hashes are kept of the outputs. It works in a directory of its own that it makes in
`<directory in memory>` (/dev/shm), and removes that and nothing else.
"""
import hashlib, json, os, random, resource, shutil, subprocess, sys, tempfile

binary, without_memo, parent, *roots = sys.argv[1:]
files = []
for root in roots:
    for directory, directories, names in os.walk(root):
        directories[:] = [name for name in directories if name != "node_modules"]
        files += [os.path.join(directory, name) for name in sorted(names) if name.endswith((".css", ".less", ".scss"))]
print(len(files), "files")


def digest(path):
    with open(path, "rb") as file:
        return hashlib.md5(file.read()).hexdigest()


def run(formatter, order, options):
    """The hash of what becomes of each file. The directories are formatted in the order of their names, which is `order`."""
    scratch = tempfile.mkdtemp(prefix="css-memo-orders-", dir=parent)
    with open(os.path.join(scratch, ".prettierrc"), "w") as file:
        json.dump(options, file)
    paths = {}
    for position, index in enumerate(order):
        # The name stays with the file, since the overrides go by it.
        paths[index] = os.path.join(scratch, f"{position:06d}", str(index) + os.path.splitext(files[index])[1])
        os.makedirs(os.path.dirname(paths[index]))
        shutil.copyfile(files[index], paths[index])
    limit = lambda: resource.setrlimit(resource.RLIMIT_AS, (8_000_000_000, 8_000_000_000))
    subprocess.run([formatter, "cli", "@format", "--threads=1", "."], cwd=scratch, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=900, preexec_fn=limit)
    result = {index: digest(path) for index, path in paths.items()}
    shutil.rmtree(scratch)
    return result


other = {"singleQuote": False, "printWidth": 100, "trailingComma": "none"}
for options in ({}, {"printWidth": 40, "singleQuote": True, "useTabs": True, "overrides": [{"files": "*[02468].*", "options": other}]}):
    results = [run(without_memo, list(range(len(files))), options)]
    for seed in (1, 2, 3):
        order = list(range(len(files)))
        random.Random(seed).shuffle(order)
        results.append(run(binary, order, options))
    changed = sum(results[0][index] != digest(path) for index, path in enumerate(files))
    different = [path for index, path in enumerate(files) if len({result[index] for result in results}) > 1]
    print(json.dumps(options)[:50], "changed by formatting:", changed, "not the same in the four runs:", len(different))
    print("\n".join(different[:20]))
