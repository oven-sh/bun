#!/usr/bin/env python3
"""left-out-bodies-in-map.py <map>: the functions of a map (BUN_JSC_aotMapFilePath) that do nothing but throw an internal error: role, name, file, position, size.
A Body that is not the constructor of a class is a function that the build left out although compiled code refers to it, or one whose parameters are proven to make it throw."""
import sys
row, found, functions = None, [], 0
for line in open(sys.argv[1], errors='replace'):
    if line.startswith('F\t'):
        row = line.rstrip('\n').split('\t')
        functions += 1
    elif line.startswith('FO') and row is not None:
        operations = {it for it in line.rstrip('\n').split('\t')[1:] if it and it not in ('Closed', 'Open', 'Generic') and not it.isdigit()}
        if operations and operations <= {'NewRuntimeError', 'Throw', 'String', 'NewString'} and 'NewRuntimeError' in operations:
            found.append((row[8], row[7], row[10], row[11] if len(row) > 11 else '', row[3]))
for it in sorted(found):
    print('\t'.join(it))
roles = {}
for it in found:
    roles[it[0]] = roles.get(it[0], 0) + 1
print('END', functions, 'functions;', roles)
