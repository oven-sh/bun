#!/usr/bin/env python3
"""What the compiler says about programs that are wrong, compared between two interpreters.

    fuzz_syntax_errors.py generate LIB OUT.jsonl [--seed N] [--count N]     (run it with the reference interpreter)
    fuzz_syntax_errors.py run CASES.jsonl RESULTS.jsonl                      (run it with each interpreter)
    fuzz_syntax_errors.py compare CASES.jsonl REFERENCE.jsonl OURS.jsonl [--examples N] [--only TEXT]

`generate` takes statements from the .py files under LIB and damages each in one place: a token is deleted, doubled, swapped with
its neighbour, replaced or inserted, the text is cut off, a line is indented differently, two lines are joined. The same seed
gives the same cases. `run` compiles every case and writes down what happened: nothing, or the exception with all its
attributes, and the warnings. `compare` groups the differences by the two messages, most frequent first.
"""
import io
import json
import os
import random
import re
import sys
import warnings

POOL = """( ) [ ] { } , : ; . = == != < > <= >= + - * / // % ** @ & | ^ ~ << >> -> := += -= *= ... ! $ ?
if else elif for while in not and or is lambda def class return yield await async with as try except finally raise import from
pass break continue global nonlocal del assert None True False match case type lazy _ x y 0 1 1.5 1j 0x 1_ 'a' "b" f'{x}' f'{' b'c' ''' \\
""".split()


def statements(path):
    import ast
    try:
        with open(path, "rb") as f:
            data = f.read()
        text = data.decode("utf-8")
        tree = ast.parse(text)
    except (SyntaxError, UnicodeDecodeError, ValueError, RecursionError):
        return
    lines = text.splitlines(keepends=True)

    def walk(body, depth):
        for node in body:
            first = min([node.lineno] + [d.lineno for d in getattr(node, "decorator_list", [])])
            size = node.end_lineno - first + 1
            if size <= 30:
                chunk = lines[first - 1:node.end_lineno]
                indent = len(chunk[0]) - len(chunk[0].lstrip(" "))
                if all(not l.strip() or l.startswith(" " * indent) for l in chunk):
                    yield "".join(l[indent:] if l.strip() else l for l in chunk)
            if depth < 3:
                for name in ("body", "orelse", "finalbody"):
                    yield from walk(getattr(node, name, None) or [], depth + 1)
    yield from walk(tree.body, 0)


def tokens_of(text):
    import tokenize
    starts = [0]
    for line in text.splitlines(keepends=True):
        starts.append(starts[-1] + len(line))
    result = []
    try:
        for token in tokenize.generate_tokens(io.StringIO(text).readline):
            if token.type in (tokenize.NEWLINE, tokenize.NL, tokenize.INDENT, tokenize.DEDENT, tokenize.ENDMARKER, tokenize.COMMENT):
                continue
            result.append((starts[token.start[0] - 1] + token.start[1], starts[token.end[0] - 1] + token.end[1]))
    except (tokenize.TokenError, SyntaxError, IndentationError):
        return []
    return result


def damage(text, rng):
    tokens = tokens_of(text)
    if len(tokens) < 2:
        return None
    kind = rng.choice(["delete", "delete", "double", "swap", "replace", "replace", "replace", "insert", "insert", "cut", "indent", "join", "delete2"])
    i = rng.randrange(len(tokens))
    start, end = tokens[i]
    if kind == "delete":
        return text[:start] + text[end:]
    if kind == "delete2":
        j = min(len(tokens) - 1, i + rng.randrange(1, 4))
        return text[:start] + text[tokens[j][1]:]
    if kind == "double":
        return text[:end] + " " + text[start:end] + text[end:]
    if kind == "swap":
        if i + 1 == len(tokens):
            return None
        start2, end2 = tokens[i + 1]
        return text[:start] + text[start2:end2] + text[end:start2] + text[start:end] + text[end2:]
    if kind == "replace":
        return text[:start] + rng.choice(POOL) + text[end:]
    if kind == "insert":
        return text[:start] + rng.choice(POOL) + " " + text[start:]
    if kind == "cut":
        return text[:rng.choice([start, end])]
    lines = text.splitlines(keepends=True)
    n = rng.randrange(len(lines))
    if kind == "indent":
        change = rng.choice([1, 2, 4, -1, -2, -4, "\t"])
        if change == "\t":
            lines[n] = "\t" + lines[n]
        elif change > 0:
            lines[n] = " " * change + lines[n]
        else:
            stripped = lines[n].lstrip(" ")
            lines[n] = " " * max(0, len(lines[n]) - len(stripped) + change) + stripped
    else:
        lines[n] = lines[n].rstrip("\n") + " "
    return "".join(lines)


def generate(lib, out, seed, count):
    rng = random.Random(seed)
    paths = []
    for directory, directories, files in os.walk(lib):
        directories.sort()
        paths.extend(os.path.join(directory, f) for f in sorted(files) if f.endswith(".py"))
    pool = []
    for path in paths:
        pool.extend(statements(path))
    pool = sorted(set(pool))
    with open(out, "w", encoding="utf-8") as f:
        written = 0
        seen = set()
        while written < count:
            text = damage(rng.choice(pool), rng)
            if text is None or text in seen or "\0" in text:
                continue
            seen.add(text)
            mode = "exec" if rng.random() < 0.9 else "single"
            f.write(json.dumps({"id": written, "mode": mode, "source": text}) + "\n")
            written += 1


def run(cases, results):
    with open(cases, encoding="utf-8") as f, open(results, "w", encoding="utf-8") as out:
        for line in f:
            case = json.loads(line)
            with warnings.catch_warnings(record=True) as caught:
                warnings.simplefilter("always")
                try:
                    compile(case["source"], "<fuzz>", case["mode"], dont_inherit=True)
                    result = None
                except SyntaxError as e:
                    result = [type(e).__name__, e.msg, e.lineno, e.offset, e.end_lineno, e.end_offset, e.text, list(e._metadata[:2]) if getattr(e, "_metadata", None) else None]
                except Exception as e:
                    result = [type(e).__name__, str(e)]
            out.write(json.dumps({"id": case["id"], "result": result, "warnings": [[w.category.__name__, str(w.message), w.lineno] for w in caught]}) + "\n")
            out.flush()


def shape(message):
    message = re.sub(r"'[^']*'", "'…'", message)
    message = re.sub(r'"[^"]*"', '"…"', message)
    return re.sub(r"\d+", "N", message)


def compare(cases, reference, ours, examples, only):
    sources = {}
    with open(cases, encoding="utf-8") as f:
        for line in f:
            case = json.loads(line)
            sources[case["id"]] = case
    def load(path):
        with open(path, encoding="utf-8") as f:
            return {r["id"]: r for r in map(json.loads, f)}
    a, b = load(reference), load(ours)
    groups = {}
    same = 0
    for key, expected in a.items():
        got = b.get(key)
        if got is None:
            groups.setdefault(("(no result: the run ended early)", ""), []).append(key)
            continue
        if expected["result"] == got["result"] and expected["warnings"] == got["warnings"]:
            same += 1
            continue
        x, y = expected["result"], got["result"]
        if x != y:
            if x is None or y is None or x[:2] != y[:2]:
                label = ("%s: %s" % (x[0], shape(x[1])) if x else "(compiles)", "%s: %s" % (y[0], shape(y[1])) if y else "(compiles)")
            elif x[2:6] != y[2:6]:
                label = ("%s: %s" % (x[0], shape(x[1])), "(same message, other position)")
            elif x[6] != y[6]:
                label = ("%s: %s" % (x[0], shape(x[1])), "(same message and position, other text)")
            else:
                label = ("%s: %s" % (x[0], shape(x[1])), "(other _metadata)")
        else:
            label = ("warnings: %s" % sorted(set(shape(w[1]) for w in expected["warnings"])), "warnings: %s" % sorted(set(shape(w[1]) for w in got["warnings"])))
        groups.setdefault(label, []).append(key)
    print("%d cases, %d the same, %d differ, in %d groups" % (len(a), same, len(a) - same, len(groups)))
    for label, keys in sorted(groups.items(), key=lambda item: -len(item[1])):
        if only and only not in label[0] and only not in label[1]:
            continue
        print("\n%5d  reference: %s\n       ours:      %s" % (len(keys), label[0], label[1]))
        for key in sorted(keys, key=lambda k: len(sources[k]["source"]))[:examples]:
            print("       #%d %s %r" % (key, sources[key]["mode"], sources[key]["source"][:400]))
            print("          %s %s" % (a[key]["result"], a[key]["warnings"] or ""))
            if key in b:
                print("          %s %s" % (b[key]["result"], b[key]["warnings"] or ""))


def option(name, default):
    if name in sys.argv:
        i = sys.argv.index(name)
        value = sys.argv[i + 1]
        del sys.argv[i:i + 2]
        return value
    return default


if __name__ == "__main__":
    seed = int(option("--seed", 1))
    count = int(option("--count", 20000))
    examples = int(option("--examples", 2))
    only = option("--only", None)
    command = sys.argv[1]
    if command == "generate":
        generate(sys.argv[2], sys.argv[3], seed, count)
    elif command == "run":
        run(sys.argv[2], sys.argv[3])
    elif command == "compare":
        compare(sys.argv[2], sys.argv[3], sys.argv[4], examples, only)
    else:
        sys.exit(__doc__)
