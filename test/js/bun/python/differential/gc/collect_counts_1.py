# gc.collect() says how many objects it found that reference counts would not have freed. One object of each kind is made and
# dropped: nothing is found unless the object is in a cycle, and then as much as CPython finds.
exec(open("collect_counts.inc").read())
run(0, 3)
