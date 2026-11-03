#!/usr/bin/env python3
"""Runs a test with every started generator, coroutine and async generator kept alive until the end, and leaves without
finalizing anything.  If the output differs from a normal run, the test relies on reference counting.
usage: keep_generators.py TEST"""
import os, sys
path = sys.argv[1]
keep = []
def prof(frame, event, arg):
    if event == 'call' and frame.f_generator is not None:
        keep.append(frame.f_generator)
src = open(path, encoding='utf-8').read()
code = compile(src, path, 'exec')
main = sys.modules['__main__']
g = main.__dict__
for k in ('keep', 'prof', 'src', 'code', 'path', 'os', 'main', 'g', 'k'):
    pass
ns = {'__name__': '__main__', '__file__': path, '__builtins__': __builtins__, '__doc__': None, '__package__': None, '__spec__': None, '__loader__': g.get('__loader__')}
mod = type(sys)('__main__'); mod.__dict__.update(ns); sys.modules['__main__'] = mod
sys.argv = [path]
status = 0
sys.setprofile(prof)
try:
    exec(code, mod.__dict__)
except SystemExit as e:
    status = e.code if isinstance(e.code, int) else 0 if e.code is None else 1
except BaseException as e:
    status = 1
sys.setprofile(None)
try: sys.stdout.flush()
except Exception: pass
os._exit(status & 255)
