# What goes through code objects to see what they import: dis._find_imports(), modulefinder.
import dis
import modulefinder
import os
import shutil
import sys
import tempfile
import types

SOURCE = '''
import os
import a.b.c
import a.b.c as d
import e as f, g
from x import y, z as w
from x.y import (p,
                 q)
from . import r
from .s import t
from .. import u
from ...v.w import *
from star import *
lazy import lz
lazy from lz2 import one, two as three
try:
    import in_try
except ImportError:
    from fallback import in_try
if os:
    import conditional
for i in ():
    import looped
with open(os.devnull) as handle:
    import managed
assigned = 1
global_name = 2


def function():
    import inside
    from inside2 import name
    global made_global
    made_global = 1
    import made_global2 as made_global

    def nested():
        from . import deep
    return nested


class Class:
    import in_class
    from in_class2 import attribute
    member = 1


async def coroutine():
    import in_coroutine


value = [__import__("not_seen") for _ in ()]
lambda: __import__("not_seen_either")
'''


def walk(code, depth=0):
    # Sorted: where the code of an exception handler lies is the compiler's business.
    print("  " * depth + code.co_name, sorted(dis._find_imports(code), key=repr), sorted(set(dis._find_store_names(code))))
    for constant in code.co_consts:
        if isinstance(constant, types.CodeType):
            walk(constant, depth + 1)


walk(compile(SOURCE, "<source>", "exec"))
walk(compile("import a\n" * 3 + "\n".join("n%d = %d" % (i, i) for i in range(300)) + "\nimport late.one\nfrom late import two\n", "<many names>", "exec"))
walk(compile("from m import " + ", ".join("n%d" % i for i in range(300)), "<many>", "exec"))
walk(compile("", "<empty>", "exec"))
walk(compile("__import__('x')", "<expression>", "eval"))
for instruction in dis.get_instructions(compile("from . import a as b\nimport c.d\nlazy import e", "<shown>", "exec")):
    if instruction.opname in ("IMPORT_NAME", "IMPORT_FROM", "STORE_NAME"):
        print(instruction.opname, instruction.argval, instruction.argrepr)

tmp = os.path.realpath(tempfile.mkdtemp())
files = {
    "main.py": "import pkg.one\nfrom pkg import two, missing_name\nimport absent\nfrom pkg.three import *\ntry:\n    import optional\nexcept ImportError:\n    pass\n",
    "pkg/__init__.py": "from . import base\n",
    "pkg/base.py": "import sys\n",
    "pkg/one.py": "from .base import something\nfrom . import two\nfrom .. import too_far\n",
    "pkg/two.py": "def f():\n    import pkg.lazy_one\n",
    "pkg/lazy_one.py": "class C:\n    import pkg.in_class\n",
    "pkg/in_class.py": "",
    "pkg/three.py": "from pkg.four import *\nx = 1\n",
    "pkg/four.py": "y = 2\ndef z(): pass\n",
    "unused.py": "",
}
for name, text in files.items():
    path = os.path.join(tmp, name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(text)
finder = modulefinder.ModuleFinder(path=[tmp])
finder.run_script(os.path.join(tmp, "main.py"))
for name, module in sorted(finder.modules.items()):
    print(name, (module.__file__ or "").replace(tmp, "<tmp>"), sorted(module.globalnames), sorted(module.starimports))
print(sorted(finder.badmodules), finder.any_missing_maybe())
shutil.rmtree(tmp)
