#!/usr/bin/env python3
"""Three-way compare of gen.cjs runs: node (the reference), main, head.

usage: tri.py <node.jsonl> <main.jsonl> <head.jsonl>
              [--fields=post] [--show=regressed|fixed|still|all] [--n=N] [--norm]

--fields  comma list of pre,post,ev,wu,st,x (default: post). "x" compares status, nocall and
          uncaught too.
--show    also list the cells of a category, with the three values of every chosen field that
          differs. "still" lists still(as main) and still(changed). "all" lists every cell that
          is not "same".
--n       how many cells --show lists (default 40, 0 = no limit).
--norm    collapse a duplicated trailing RST_STREAM token in pre and post ("H R0 R0" -> "H R0").

Categories, per cell, on the chosen fields:
  same            main == node and head == node
  fixed           main != node and head == node
  regressed       main == node and head != node
  still(as main)  main != node and head != node and head == main
  still(changed)  main != node and head != node and head != main
  missing         the cell is not in all three files
"""
import json
import os
import re
import sys

PLAIN = ("pre", "post", "ev", "wu", "st")
EXTRA = ("status", "nocall", "uncaught")
CATEGORIES = ("same", "fixed", "regressed", "still(as main)", "still(changed)", "missing")
SHOW = {
    "regressed": ("regressed",),
    "fixed": ("fixed",),
    "still": ("still(as main)", "still(changed)"),
    "all": ("fixed", "regressed", "still(as main)", "still(changed)", "missing"),
}
# The wire ends where " G<code>" (GOAWAY) or " X" (socket closed) starts.
TWICE = re.compile(r"( R\d+)\1(?=(?: G\d+)?(?: X)?$)")


def load(path):
    """id -> cell, and the ids in file order."""
    cells = {}
    order = []
    with open(path) as file:
        for number, line in enumerate(file, 1):
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            try:
                cell = json.loads(line)
            except ValueError as err:
                sys.exit(f"{path}:{number}: not JSON: {err}")
            if "id" not in cell:
                sys.exit(f"{path}:{number}: no id")
            if cell["id"] in cells:
                sys.exit(f"{path}:{number}: duplicate id {cell['id']}")
            cells[cell["id"]] = cell
            order.append(cell["id"])
    return cells, order


def parse_fields(text):
    fields = [name for name in text.split(",") if name]
    if not fields:
        sys.exit("--fields is empty")
    for name in fields:
        if name not in PLAIN and name != "x":
            sys.exit(f"unknown field {name!r}: use a comma list of {','.join(PLAIN)},x")
    return fields


def value(cell, field, norm):
    if field == "x":
        return {name: cell[name] for name in EXTRA if name in cell}
    val = cell.get(field)
    if norm and field in ("pre", "post") and isinstance(val, str):
        val = TWICE.sub(r"\1", val)
    return val


def text(val):
    if isinstance(val, list):
        return ",".join(str(item) for item in val) or "-"
    if isinstance(val, dict):
        return json.dumps(val, sort_keys=True) if val else "-"
    return "-" if val is None else str(val)


def main(argv):
    paths = [arg for arg in argv if not arg.startswith("--")]
    options = dict(arg[2:].split("=", 1) if "=" in arg else (arg[2:], "") for arg in argv if arg.startswith("--"))
    unknown = set(options) - {"fields", "show", "n", "norm"}
    if len(paths) != 3 or unknown:
        sys.exit(__doc__.strip())
    fields = parse_fields(options.get("fields", "post"))
    norm = "norm" in options
    show = options.get("show")
    if show is not None and show not in SHOW:
        sys.exit(f"--show={show}: use one of {'|'.join(SHOW)}")
    limit = int(options.get("n", "40"))

    (node, order), (main_run, order_main), (head, order_head) = (load(path) for path in paths)
    ids = list(order)
    seen = set(ids)
    for cell_id in order_main + order_head:
        if cell_id not in seen:
            seen.add(cell_id)
            ids.append(cell_id)

    counts = {category: 0 for category in CATEGORIES}
    listed = []
    for cell_id in ids:
        cells = (node.get(cell_id), main_run.get(cell_id), head.get(cell_id))
        if any(cell is None for cell in cells):
            category = "missing"
            differing = []
        else:
            n, m, h = ([value(cell, field, norm) for field in fields] for cell in cells)
            if m == n:
                category = "same" if h == n else "regressed"
            elif h == n:
                category = "fixed"
            else:
                category = "still(as main)" if h == m else "still(changed)"
            differing = [i for i in range(len(fields)) if not n[i] == m[i] == h[i]]
        counts[category] += 1
        if show is not None and category in SHOW[show]:
            listed.append((category, cell_id, cells, differing))

    print(f"{len(ids)} cells, fields: {','.join(fields)}{' (--norm)' if norm else ''}")
    print(f"  node: {paths[0]} ({len(node)})  main: {paths[1]} ({len(main_run)})  head: {paths[2]} ({len(head)})")
    for category in CATEGORIES:
        if category != "missing" or counts[category]:
            print(f"  {category:<15} {counts[category]:>5}")

    if show is not None:
        print()
        print(f"--show={show}: {len(listed)} cells")
        for category, cell_id, cells, differing in listed if limit <= 0 else listed[:limit]:
            print(f"[{category}] {cell_id}")
            if category == "missing":
                names = [name for name, cell in zip(("node", "main", "head"), cells) if cell is None]
                print(f"    not in: {', '.join(names)}")
                continue
            for i in differing:
                for name, cell in zip(("node", "main", "head"), cells):
                    label = fields[i] if name == "node" else ""
                    print(f"    {label:>4}  {name}: {text(value(cell, fields[i], norm))}")
        if limit > 0 and len(listed) > limit:
            print(f"... {len(listed) - limit} more (--n=0 lists all)")
    return 0


if __name__ == "__main__":
    try:
        code = main(sys.argv[1:])
        sys.stdout.flush()
    except BrokenPipeError:
        # `... | head`: nobody reads the rest.
        os.dup2(os.open(os.devnull, os.O_WRONLY), sys.stdout.fileno())
        code = 0
    sys.exit(code)
