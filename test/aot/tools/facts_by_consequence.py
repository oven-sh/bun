#!/usr/bin/env python3
# facts_by_consequence.py <folder> ..
# Each folder holds old.explain.json and new.explain.json: what `bun build --compile --aot --explain=json` prints for one program,
# by an earlier binary and by this tree.
#
# The two flows number nothing alike, so their facts cannot be laid side by side. What the facts lead to can: both compilers name
# the place in the source that cost a proof, why, and how many accesses and calls it cost.
# Places are compared first, reasons second: the two compilers spell many reasons differently and put some columns elsewhere on the line.
#   lost       a line that only the new compiler names: a fact that the old flow had and the new one lacks
#   respelled  a line that both name, under another reason or at another column: no fact is lost or gained
#   gained     a line that only the old compiler names
#
# The counts of the first table are no measure by themselves: a call that is walked at its call leaves no record,
# and a body that is copied counts once a copy.
import json
import os
import sys
from collections import defaultdict


def read(path):
    summary, causes = None, {}
    with open(path, errors="replace") as file:
        for line in file:
            try:
                row = json.loads(line)
            except ValueError:
                continue
            if "reason" not in row:
                if summary is None and isinstance(row.get("calls"), dict) and isinstance(row.get("accesses"), dict):
                    summary = row
                continue
            key = (row["reason"], row.get("file", ""), row.get("line", 0), row.get("column", 0))
            cost = row.get("accesses", 0) + row.get("dependencyAccesses", 0) + row.get("calls", 0) + row.get("operators", 0)
            causes[key] = causes.get(key, 0) + cost
    return summary, causes


def counts(summary):
    accesses, calls = summary["accesses"], summary["calls"]
    return [accesses["byName"], accesses["tested"], accesses["free"], calls["unknown"], calls["guarded"], calls["proven"]]


def reasons_by_line(causes):
    lines = defaultdict(set)
    for reason, file, line, _ in causes:
        lines[(file, line)].add(reason)
    return lines


def print_by_reason(title, table):
    print(f"\n{title} (reason: places, what they cost)")
    for reason, (places, cost) in sorted(table.items(), key=lambda item: -item[1][1]):
        print(f"  {reason:60} {places:6} {cost:8}")


def main(folders):
    heads = ["by name", "tested", "free", "unknown", "guarded", "proven"]
    totals = [[0] * 6, [0] * 6]
    lost_by_reason, respelled, gained_by_reason = (defaultdict(lambda: [0, 0]) for _ in range(3))
    lost = []
    programs = 0
    for folder in folders:
        old_path, new_path = os.path.join(folder, "old.explain.json"), os.path.join(folder, "new.explain.json")
        if not (os.path.exists(old_path) and os.path.exists(new_path)):
            continue
        (old_summary, old_causes), (new_summary, new_causes) = read(old_path), read(new_path)
        if not old_summary or not new_summary:
            continue
        programs += 1
        for total, summary in zip(totals, (old_summary, new_summary)):
            for index, count in enumerate(counts(summary)):
                total[index] += count
        name = os.path.basename(os.path.normpath(folder))
        old_lines, new_lines = reasons_by_line(old_causes), reasons_by_line(new_causes)
        for key, cost in new_causes.items():
            if key in old_causes:
                continue
            reason, file, line, _ = key
            row = lost_by_reason[reason]
            if old_reasons := old_lines.get((file, line)):
                row = respelled[reason if reason in old_reasons else f"{' | '.join(sorted(old_reasons))} > {reason}"]
            else:
                lost.append((cost, name, key))
            row[0] += 1
            row[1] += cost
        for key, cost in old_causes.items():
            if (key[1], key[2]) not in new_lines:
                gained_by_reason[key[0]][0] += 1
                gained_by_reason[key[0]][1] += cost

    print(f"{programs} programs. Accesses and calls, old | new:")
    for index, head in enumerate(heads):
        kind = "accesses" if index < 3 else "calls"
        print(f"  {kind:8} {head:8} {totals[0][index]:8} | {totals[1][index]:8}")
    print_by_reason("LOST: lines that only the new compiler names", lost_by_reason)
    print_by_reason("RESPELLED: lines that both name: old reasons > new reason; a reason alone: the same reason at another column", respelled)
    print_by_reason("GAINED: lines that only the old compiler names", gained_by_reason)
    print("\nThe dearest lines that only the new compiler names:")
    for cost, name, (reason, file, line, column) in sorted(lost, reverse=True)[:40]:
        print(f"  {cost:6} {name:36} {reason:36} {file}:{line}:{column}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("facts_by_consequence.py <folder> ..")
    main(sys.argv[1:])
