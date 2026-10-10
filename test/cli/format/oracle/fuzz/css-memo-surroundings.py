#!/usr/bin/env python3
"""What `src/format/css/memo.rs` keeps must not show in the output: the same declaration in other surroundings is another declaration.

    python3 css-memo-surroundings.py <bun-lint> <bun-lint without the memo> <directory in memory> <seed> <count> <directories with style sheets..>

It takes 600 declarations from the style sheets and makes `count` small style sheets of them: in 24 kinds of rules and at-rules, with 20
ways to end a declaration, cut off, without a value, with a character put in. A few declarations come up again and again. One thread
formats them all, with and without the memo (see `css-memo-orders.py` for that binary). It works in a directory of its own that it makes in
`<directory in memory>` (/dev/shm). It prints that directory and the names of those that differ, which are left there. Everything else that
it has made is removed, and nothing that it has not made.
"""
import os, random, re, resource, shutil, subprocess, sys, tempfile

binary, without_memo, parent, seed, count, *roots = sys.argv[1:]
scratch = tempfile.mkdtemp(prefix="css-memo-surroundings-", dir=parent)
rnd = random.Random(int(seed))
pool = set()
for root in roots:
    for directory, _, names in os.walk(root):
        for name in sorted(names):
            if name.endswith((".css", ".less", ".scss")):
                with open(os.path.join(directory, name), errors="replace") as file:
                    pool.update(match.group(1) for match in re.finditer(r"[{;]\s*([-\w$@*#.]+\s*:\s*[^;{}]+?)\s*(?=[;}])", file.read()))
pool = sorted(pool)
rnd.shuffle(pool)
pool = pool[:600]
ends = [";", "", " ;", ";;", "\n;", " /*c*/;", "!important;", " ! important;", " !IMPORTANT", " ", "  ", "\t;", " !default;", " !global;", ",;", " \;", ";/*c*/", " //c\n;", "\n", "   \n  ;"]
surroundings = ["a{%s}", "a {\n  %s\n}", "@media x{a{%s}}", "@supports (a:b){a{%s}}", "@font-face{%s}", ":export{%s}", ':import("x"){%s}', "@keyframes k{from{%s}}", "@utility x{%s}", "@include x{%s}", "@if $a{b{%s}}", "@each $a in $b{c{%s}}", "%s", "a{b{c{d{e{f{%s}}}}}}", "@detached:{%s}", ".m(){%s}", "a{--x:{%s}}", "a{font:{%s}}", "@namespace x{%s}", "@import x{%s}", "@forward x{%s}", "@nest a{%s}", "@custom-selector :--a b{%s}", "@page :first{%s}"]
bits = [" ", "  ", "\t", "\n", "*", "_", "/**/", "--", "$", "@", "#", "(", ")", '"', "'", "\\", "!", ",", "/", "+", "-", "é", "0", ".", "e", "%"]

directories = {formatter: os.path.join(scratch, name) for formatter, name in ((binary, "with"), (without_memo, "without"))}
for directory in directories.values():
    os.makedirs(directory)
for index in range(int(count)):
    parts = []
    for _ in range(rnd.randint(1, 2)):
        declarations = []
        for _ in range(rnd.randint(1, 5)):
            declaration = rnd.choice(pool[: rnd.choice([5, 40, 600])])
            colon = declaration.find(":")
            if rnd.random() < 0.08:
                at = rnd.choice([0, len(declaration), colon, colon + 1, rnd.randint(0, len(declaration))])
                declaration = declaration[:at] + rnd.choice(bits) + declaration[at:]
            if rnd.random() < 0.05:
                declaration = declaration[: colon + 1] + rnd.choice(["", " ", "  ", "   ", "\t", "\n", " \n "])
            if rnd.random() < 0.05:
                declaration = declaration[: rnd.randint(1, len(declaration))]
            declarations.append(declaration + (rnd.choice(ends) if rnd.random() < 0.3 else ";"))
        parts.append(rnd.choice(surroundings).replace("%s", rnd.choice(["", " ", "\n  "]).join(declarations)))
    name = f"{index:06d}" + rnd.choice([".css", ".css", ".less", ".scss"])
    for directory in directories.values():
        with open(os.path.join(directory, name), "w") as file:
            file.write("\n".join(parts))
limit = lambda: resource.setrlimit(resource.RLIMIT_AS, (8_000_000_000, 8_000_000_000))
for formatter, directory in directories.items():
    subprocess.run([formatter, "cli", "@format", "--threads=1", "."], cwd=directory, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=900, preexec_fn=limit)
different = []
for name in sorted(os.listdir(directories[binary])):
    paths = [os.path.join(directory, name) for directory in directories.values()]
    contents = [open(path, "rb").read() for path in paths]
    if contents[0] != contents[1]:
        different.append(name)
    else:
        for path in paths:
            os.remove(path)
print("seed", seed, "files", count, "differ", len(different), scratch if different else "", different[:10])
if not different:
    shutil.rmtree(scratch)
