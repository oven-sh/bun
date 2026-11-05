# The scripts on dicts again, in processes where every dict, those of the interpreter included, goes over to placing its str keys by hash()
# early: after a search of a few steps, or from a small size on, so that it happens in the middle of whatever a dict can be doing. Only a
# build with assertions has the two -X options for that, so only there does this test what a long search and a large table bring
# about. Any other build takes no notice of the options, nor does CPython, and the scripts print what they always print.
# (dict_modes.py gets dicts to go over in every build, and so does slow/dict_large.py.)
# Such a build is slow, so this is the short form: the scripts that take it long with one pair of limits, the others with three. With the argument `all`: 45 processes, four
# minutes there. That form is for whoever changes dicts; it is no test of its own, since the tests that are too slow for such builds are left out just there.
import hashlib, os, subprocess, sys

LIMITS = [(), (0, 3), (1, None), (3, 5), (None, 4), (None, 5), (None, 6), (2, 7)]
if 'all' in sys.argv[1:]:
    PLAN = [('dict_modes.py', LIMITS[:4]), ('dict_foreign_keys.py', LIMITS[:4]), ('dict_str_subclass_keys.py', LIMITS[:4]), ('dict_keys_of_changed_classes.py', LIMITS[:4]),
            ('dict_reentrant_eq.py', LIMITS[:5]), ('dict_bulk_paths.py', LIMITS), ('stale_hash_identity.py', LIMITS[:3]), ('dict_key_views.py', LIMITS[:3]),
            ('dict_calls_of_keys.py one 0 100 40', LIMITS[:5]), ('dict_calls_of_keys.py two 0 100 60', LIMITS[:5])]
    SHARES = 4
else:
    FEW = [(0, 3), (1, None), (None, 4)]
    PLAN = [('dict_modes.py', FEW[:1]), ('dict_reentrant_eq.py few', FEW[:1]), ('dict_bulk_paths.py', FEW), ('dict_foreign_keys.py', FEW), ('dict_str_subclass_keys.py', FEW),
            ('dict_keys_of_changed_classes.py', FEW), ('stale_hash_identity.py', FEW[:2]), ('dict_key_views.py', FEW[:2]), ('dict_calls_of_keys.py one 0 100 40', FEW),
            ('dict_calls_of_keys.py two 0 100 60', FEW)]
    SHARES = 48
commands = []
for script, limits in PLAN:
    for number, pair in enumerate(limits):
        # (The programs of dict_calls_of_keys.py need a seed, which -I would have ignored.)
        command = [sys.executable, '-P' if script.startswith('dict_calls_of_keys.py') else '-I', '-X', 'utf8']
        for name, limit in zip(('dict_keyed_after_steps', 'dict_keyed_from_log2_size'), pair):
            if limit is not None: command += ['-X', '%s=%d' % (name, limit)]
        command += script.split()
        # (Of the many cases of this one, each process goes through its share.)
        if script == 'dict_bulk_paths.py': command += [str(SHARES), str(number % SHARES)]
        commands.append((script, pair, command))
# Six at a time, the long ones first.
running = []; results = {}
def wait_for_one():
    index, process = running.pop(0)
    out, err = process.communicate()
    results[index] = (process.returncode, len(out.splitlines()), hashlib.sha256(out.encode()).hexdigest()[:16], err[-500:])
for index, (script, pair, command) in enumerate(commands):
    if len(running) == 6: wait_for_one()
    running.append((index, subprocess.Popen(command, env=dict(os.environ, PYTHONHASHSEED='0'), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)))
while running: wait_for_one()
for index, (script, pair, command) in enumerate(commands): print(script, pair, *results[index])
