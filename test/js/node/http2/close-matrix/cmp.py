#!/usr/bin/env python3
"""Lists the cells that differ between two runs of gen.cjs.

usage: cmp.py <a.jsonl> <b.jsonl> [--fields=pre,post,ev,wu,st,x] [--show=N]

Fields: pre, post, ev, wu, st. "x" stands for status, nocall and uncaught together.
Default fields: pre,post,ev,wu,st,x. Default --show: 40 cells (0 shows none, "all" shows all).
Exit code: 0 when the runs are the same on the chosen fields, 1 otherwise.
"""
import json
import os
import sys

PLAIN = ("pre", "post", "ev", "wu", "st")
EXTRA = ("status", "nocall", "uncaught")


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
    for name in fields:
        if name not in PLAIN and name != "x":
            sys.exit(f"unknown field {name!r}: use a comma list of {','.join(PLAIN)},x")
    return fields


def value(cell, field):
    """What a cell has for a field. A cell that is missing from a run compares as "<missing>"."""
    if cell is None:
        return "<missing>"
    if field == "x":
        return {name: cell[name] for name in EXTRA if name in cell}
    return cell.get(field)


def text(val):
    if isinstance(val, list):
        return ",".join(str(item) for item in val) or "-"
    if isinstance(val, dict):
        return json.dumps(val, sort_keys=True) if val else "-"
    return "-" if val is None else str(val)


def main(argv):
    paths = [arg for arg in argv if not arg.startswith("--")]
    options = dict(arg[2:].split("=", 1) if "=" in arg else (arg[2:], "") for arg in argv if arg.startswith("--"))
    unknown = set(options) - {"fields", "show"}
    if len(paths) != 2 or unknown:
        sys.exit(__doc__.strip())
    fields = parse_fields(options.get("fields", "pre,post,ev,wu,st,x"))
    show = options.get("show", "40")
    limit = None if show == "all" else int(show)

    a, order = load(paths[0])
    b, order_b = load(paths[1])
    ids = order + [cell_id for cell_id in order_b if cell_id not in a]

    per_field = {field: 0 for field in fields}
    differing = []
    for cell_id in ids:
        changed = [f for f in fields if value(a.get(cell_id), f) != value(b.get(cell_id), f)]
        for field in changed:
            per_field[field] += 1
        if changed:
            differing.append((cell_id, changed))

    print(f"{len(ids)} cells ({len(a)} in a, {len(b)} in b), {len(differing)} differ on {','.join(fields)}")
    print("per field: " + "  ".join(f"{field}={count}" for field, count in per_field.items()))
    for cell_id, changed in differing if limit is None else differing[:limit]:
        print(cell_id)
        for field in changed:
            print(f"    {field:>4}  a: {text(value(a.get(cell_id), field))}")
            print(f"          b: {text(value(b.get(cell_id), field))}")
    if limit is not None and len(differing) > limit:
        print(f"... {len(differing) - limit} more (--show=all)")
    return 1 if differing else 0


if __name__ == "__main__":
    try:
        code = main(sys.argv[1:])
        sys.stdout.flush()
    except BrokenPipeError:
        # `... | head`: nobody reads the rest.
        os.dup2(os.open(os.devnull, os.O_WRONLY), sys.stdout.fileno())
        code = 0
    sys.exit(code)
