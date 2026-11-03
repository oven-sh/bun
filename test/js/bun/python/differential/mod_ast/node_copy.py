import _ast as ast

def show(n):
    return (type(n).__name__, sorted((k, v if not isinstance(v, ast.AST) else type(v).__name__) for k, v in vars(n).items()))

def t(f):
    try:
        r = f()
    except BaseException as e:
        print(type(e).__name__ + ':', e)
    else:
        print(r)

n = ast.Name('x', ast.Load(), lineno=1, col_offset=2)
r = n.__reduce__()
print(r[0] is ast.Name, r[1], r[2] is n.__dict__, len(r))
print(ast.Load().__reduce__())
print(ast.Name.__new__(ast.Name).__reduce__())
m = ast.BinOp.__new__(ast.BinOp)
m.left = 1
m.right = 2
print(m.__reduce__()[1:])
m.op = 3
print(m.__reduce__()[1:])
print(ast.AST().__reduce__()[1:])
class NoFields(ast.AST):
    pass
x = NoFields()
x.a = 1
print(x.__reduce__()[1:])
print(n.__reduce_ex__(2)[1:])

t(lambda: show(n.__replace__()))
t(lambda: show(n.__replace__(id='y')))
t(lambda: show(n.__replace__(lineno=10)))
t(lambda: show(n.__replace__(foo=1)))
t(lambda: n.__replace__(1))
t(lambda: n.__replace__() is n)
t(lambda: show(ast.Load().__replace__()))
t(lambda: show(m.__replace__(op=4)))
k = ast.BinOp.__new__(ast.BinOp)
t(lambda: show(k.__replace__()))
t(lambda: show(k.__replace__(left=1, op=2, right=3)))
n.extra = 5
t(lambda: show(n.__replace__()))
