# ast.AST is a class like any other.
import ast, warnings
def attempt(thunk):
    with warnings.catch_warnings(record=True) as w:
        warnings.simplefilter("always")
        try:
            r = thunk()
        except BaseException as e:
            r = type(e).__name__ + ": " + str(e)
    return r, [(x.category.__name__, str(x.message)) for x in w]
print(attempt(lambda: type(ast.AST()).__name__))
print(attempt(lambda: type(ast.AST(arg1=123)).__name__))
old = ast.AST._fields
del ast.AST._fields
print(attempt(lambda: ast.AST(arg1=123)))
print(attempt(lambda: ast.AST()))
print(attempt(lambda: ast.Name("x")))
print(attempt(lambda: ast.Module()))
ast.AST._fields = old
print(attempt(lambda: type(ast.AST()).__name__))
ast.Name.extra = 1
print(ast.Name.extra, ast.Name("x").extra)
del ast.Name.extra
print(bool(ast.AST.__flags__ & (1 << 8)), bool(ast.AST.__flags__ & (1 << 9)), bool(ast.Name.__flags__ & (1 << 9)))
print(attempt(lambda: setattr(ast.Name, "_fields", ("a", "b"))), attempt(lambda: ast.dump(ast.Name(1, 2))))
ast.Name._fields = ("id", "ctx")
print(attempt(lambda: setattr(ast.AST, "__name__", "X")), ast.AST.__name__)
ast.AST.__name__ = "AST"
