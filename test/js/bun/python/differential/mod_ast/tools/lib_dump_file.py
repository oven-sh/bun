# ast.dump() of each file named on the command line.
import sys, ast
sys.setrecursionlimit(20000)
for path in sys.argv[1:]:
    with open(path, 'rb') as f:
        data = f.read()
    try:
        tree = ast.parse(data, path, type_comments=True)
    except SyntaxError as e:
        print('SyntaxError', e)
        continue
    print(ast.dump(tree, include_attributes=True, indent=1))
    print(sum(1 for _ in ast.walk(tree)))
