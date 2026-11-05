# All the cases of mod_hash/dict_bulk_paths.py, which goes through one in 16.
try: import os, runpy, sys
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import os, runpy, sys')
try: above = os.path.dirname(os.path.abspath(__file__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: above = os.path.dirname(os.path.abspath(__file__))')
try:
    while not os.path.isdir(os.path.join(above, 'mod_hash')): above = os.path.dirname(above)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: while not os.path.isdir(os.path.join(above, 'mod_hash')): above = os....")
try: sys.argv = [os.path.join(above, 'mod_hash', 'dict_bulk_paths.py'), '1', '0']
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: sys.argv = [os.path.join(above, 'mod_hash', 'dict_bulk_paths.py'), '1...")
try: runpy.run_path(sys.argv[0], run_name='__main__')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: runpy.run_path(sys.argv[0], run_name='__main__')")
