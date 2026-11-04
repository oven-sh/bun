# `return`, `break` and `continue` in a `finally` clause are warned of for the whole program before anything else is found wrong with it.
# A docstring that UTF-8 cannot write is an error of its own kind, found when the body it belongs to is compiled.
import ast
import warnings


def t(source, **options):
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        try:
            compile(source, "<x>", "exec", **options)
            outcome = "ok"
        except (SyntaxError, UnicodeError) as e:
            outcome = "%s: %s" % (type(e).__name__, e)
            if isinstance(e, UnicodeError):
                outcome += " %r" % ((e.encoding, e.object, e.start, e.end, e.reason),)
    print(repr(source), options or "", "->", outcome, [(w.category.__name__, str(w.message), w.lineno) for w in caught])


F = "def f():\n  try:\n    pass\n  finally:\n    return\n"
t("try:\n  pass\nfinally:\n  return\n")
t("try:\n  pass\nfinally:\n  break\n")
t("try:\n  pass\nfinally:\n  continue\n")
t("class C:\n  try:\n    pass\n  finally:\n    return\n")
t("def f():\n  try:\n    pass\n  finally:\n    class C:\n      return\n")
t(F + "return")
t("return\n" + F)
t(F + "x = yield")
t(F + "await x")
t(F + "nonlocal q")
t(F + "def g(a, a): pass")
t(F + "1 is 1\nbreak")
t("1 is 1\nbreak")
t("break\n1 is 1")
t("1 is 1\nreturn")
t("assert (1, 'x')\nreturn")
t(F + "(")
t(F + "from __future__ import annotations")
t("from __future__ import nothing\n" + F)
t("def f():\n  try:\n    pass\n  finally:\n    def g(): return\n    for x in y: break\n    while 1: continue\n    lambda: (yield)\n")
t("def f():\n  for x in y:\n    try:\n      pass\n    finally:\n      for z in y:\n        pass\n      else:\n        break\n")
t("def f():\n  for x in y:\n    try:\n      pass\n    finally:\n      while z:\n        pass\n      else:\n        continue\n")
t("def f():\n  for x in y:\n    try:\n      pass\n    finally:\n      if x:\n        break\n      with x:\n        continue\n      match x:\n        case 1:\n          return\n")
t("def f():\n  try:\n    pass\n  finally:\n    try:\n      return 1\n    except E:\n      return 2\n    else:\n      return 3\n    finally:\n      return 4\n")
t("def f():\n  try:\n    return 1\n  except* E:\n    pass\n  finally:\n    return 2\n")
t("async def f():\n  async for x in y:\n    try:\n      pass\n    finally:\n      async with x:\n        break\n")
t("def f():\n  while 0:\n    try:\n      pass\n    finally:\n      return\n")
t("def f():\n  if 0:\n    try:\n      pass\n    finally:\n      return\n")
t("def f():\n  return\n  try:\n    pass\n  finally:\n    return\n")
with warnings.catch_warnings():
    warnings.simplefilter("error")
    t2 = []
    for source in (F, "return\n" + F):
        try:
            compile(source, "<x>", "exec")
        except SyntaxError as e:
            t2.append((e.msg, e.lineno, e.offset, e.end_lineno, e.end_offset))
    print(t2)
with warnings.catch_warnings(record=True) as caught:
    warnings.simplefilter("always")
    tree = ast.parse(F)
    print("parsed", len(caught))
    compile(tree, "<x>", "exec")
    print("compiled", [(str(w.message), w.lineno) for w in caught])

t("'\\ud800'")
t("x = 1\n'\\ud800'")
t("'a\\ud800'\nx = 1")
t("def f():\n  'ab\\udfff'")
t("def f():\n  x = 1\n  'ab\\udfff'")
t("class C:\n  'ab\\udfff'")
t("async def f():\n  '''\n   ab\\udfff'''")
t("'\\U00010000\\udc00x\\ud800'")
t("'\\ud800'", optimize=2)
t("def f():\n  '\\ud800'", optimize=2)
t("'\\ud800'", optimize=1)
t("f'\\ud800'")
t("'\\ud800' 'x'")
t("lambda: '\\ud800'")
t("'\\ud800'\nreturn")
t("def f():\n  '\\ud800'\nreturn")
t("return\n'\\ud800'")
t("return\ndef f():\n  '\\ud800'")
t("'\\ud800'\nnonlocal q")
t("'\\ud800'\n" + F)
try:
    compile("'\\ud800'", "<x>", "single")
    print("single: ok")
except UnicodeError as e:
    print("single:", e)
print(eval("'\\ud800'") == "\ud800")
