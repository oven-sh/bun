# What is said when a module has not got a name: circular imports, and files that hide a module of the same name.
import concurrent.futures
import os
import subprocess
import sys
import tempfile
import textwrap


cases = []


def run(title, files, *args):
    cases.append((title, files, args))


def carry_out(case):
    title, files, args = case
    with tempfile.TemporaryDirectory() as tmp:
        tmp = os.path.realpath(tmp)
        for name, text in files.items():
            path = os.path.join(tmp, name)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w", encoding="utf-8") as f:
                f.write(textwrap.dedent(text))
        environment = {name: value for name, value in os.environ.items() if not name.startswith("PYTHON")}
        environment["PYTHONDONTWRITEBYTECODE"] = "1"
        result = subprocess.run([sys.executable, *args], cwd=tmp, env=environment, capture_output=True, text=True)
        return "== %s %s %s\n%s" % (title, args, result.returncode, (result.stdout + result.stderr).replace(tmp, "<tmp>").rstrip())


SHOW = """
import sys
def show(function):
    try:
        function()
    except (ImportError, AttributeError, TypeError) as e:
        print(type(e).__name__, e, '|', getattr(e, 'name', None), getattr(e, 'path', None), getattr(e, 'name_from', None), getattr(e, 'obj', None) is not None)
"""



def showing(text):
    return SHOW + textwrap.dedent(text)


for statement in ("import fractions\nfractions.Fraction", "from fractions import Fraction"):
    run("a script hides the standard library", {"fractions.py": statement}, "fractions.py")
    run("a module beside the script", {"fractions.py": "x = 1", "main.py": statement}, "main.py")
    run("with -c", {"fractions.py": "x = 1"}, "-c", statement)
    run("with -m", {"fractions.py": "x = 1", "main.py": statement}, "-m", "main")
    run("a package", {"fractions/__init__.py": "x = 1", "main.py": statement}, "main.py")
    run("safe path", {"fractions.py": "x = 1", "main.py": "import sys; sys.path.insert(0, '.')\n" + statement}, "-P", "main.py")
    run("isolated", {"fractions.py": "x = 1", "main.py": "import sys; sys.path.insert(0, '.')\n" + statement}, "-I", "main.py")
    run("elsewhere on the path", {"lib/fractions.py": "x = 1", "main.py": "import sys; sys.path.insert(0, 'lib')\n" + statement}, "main.py")
    run("the path has changed since", {"fractions.py": "x = 1", "main.py": "import sys; sys.path.insert(0, 'nowhere')\n" + statement}, "main.py")
for statement in ("import numpy\nnumpy.array", "from numpy import array"):
    run("a script hides a library", {"numpy.py": statement}, "numpy.py")
    run("a module that is done", {"numpy.py": "x = 1", "main.py": statement}, "main.py")
    run("a package that is not done", {"numpy/__init__.py": statement, "main.py": "import numpy"}, "main.py")

run("circular", {
    "a.py": "import b\nx = 1",
    "b.py": showing("""
        import a
        show(lambda: a.x)
        def f():
            from a import x
        show(f)
        """),
    "pkg/__init__.py": "",
    "pkg/c.py": "from . import d\ny = 1",
    "pkg/d.py": showing("""
        from . import c
        show(lambda: c.y)
        def f():
            from .c import y
        show(f)
        def g():
            from pkg import nothing
        show(g)
        """),
    "sub/__init__.py": "from sub import child",
    "sub/child.py": showing("""
        import sub.other
        show(lambda: sub.other)
        show(lambda: sub.child)
        """),
    "sub/other.py": "",
    "lib/main.py": "import sys; sys.path.insert(0, '.')\nimport a, pkg.c, sub",
}, "lib/main.py")

run("odd modules", {"main.py": showing("""
    import types
    from importlib.machinery import ModuleSpec
    m = types.ModuleType('m')
    sys.modules['m'] = m
    def get(): m.x
    def take():
        from m import x
    def both():
        show(get)
        show(take)
    both()
    m.__file__ = '/somewhere/m.py'
    both()
    m.__spec__ = ModuleSpec('m', None, origin='/elsewhere/m.py')
    both()
    m.__spec__.has_location = True
    both()
    m.__spec__._initializing = True
    both()
    m.__spec__.origin = None
    both()
    del m.__file__
    both()
    m.__spec__._initializing = False
    m.__spec__._uninitialized_submodules = ['x']
    both()
    m.__spec__ = 5
    both()
    del m.__spec__
    both()
    m.__name__ = 5
    both()
    del m.__name__
    both()
    class Raises:
        _initializing = False
        name = 'm'
        origin = loader = None
        def __getattr__(self, name):
            raise TypeError('asked for ' + name)
    m.__name__ = 'm'
    m.__spec__ = Raises()
    both()
    class NotAModule:
        __name__ = 'n'
        __file__ = '/n.py'
    sys.modules['n'] = NotAModule()
    def take():
        from n import x
    show(take)
    print(repr(m)[:20], repr(types.ModuleType('q')))
    """)}, "main.py")

with concurrent.futures.ThreadPoolExecutor(8) as pool:
    for text in pool.map(carry_out, cases):
        print(text)
