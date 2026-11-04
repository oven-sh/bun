# Written by tools/gen.py.
import os, sys
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from engine import run
run('construction', 1, 1000)
