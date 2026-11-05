# All the cases of mod_hash/dict_bulk_paths.py, which goes through one in 16.
import os, runpy, sys
above = os.path.dirname(os.path.abspath(__file__))
while not os.path.isdir(os.path.join(above, 'mod_hash')): above = os.path.dirname(above)
sys.argv = [os.path.join(above, 'mod_hash', 'dict_bulk_paths.py'), '1', '0']
runpy.run_path(sys.argv[0], run_name='__main__')
