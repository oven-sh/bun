# The scripts on dicts again, in processes where every dict, those of the interpreter included, goes over to placing its str keys by hash()
# early: after a search of a few steps, or from a small size on, so that it happens in the middle of whatever a dict can be doing. Only a
# build with assertions has the two -X options for that, so only there does this test what a long search and a large table bring
# about. Any other build takes no notice of the options, nor does CPython, and the scripts print what they always print.
# (dict_modes.py gets dicts to go over in every build, and so does slow/dict_large.py.)
import hashlib, os, subprocess, sys

LIMITS = [(), (0, 3), (1, None), (3, 5), (None, 4), (None, 5), (None, 6), (2, 7)]
for script, limits in [('dict_modes.py', LIMITS[:4]), ('dict_foreign_keys.py', LIMITS[:4]), ('dict_str_subclass_keys.py', LIMITS[:4]), ('dict_keys_of_changed_classes.py', LIMITS[:4]),
                       ('dict_reentrant_eq.py', LIMITS[:5]), ('dict_bulk_paths.py', LIMITS), ('stale_hash_identity.py', LIMITS[:3]), ('dict_key_views.py', LIMITS[:3]),
                       ('dict_calls_of_keys.py one 0 100 40', LIMITS[:5]), ('dict_calls_of_keys.py two 0 100 60', LIMITS[:5])]:
    running = []
    for number, pair in enumerate(limits):
        # (The programs of dict_calls_of_keys.py need a seed, which -I would have ignored.)
        command = [sys.executable, '-P' if ' ' in script else '-I', '-X', 'utf8']
        for name, limit in zip(('dict_keyed_after_steps', 'dict_keyed_from_log2_size'), pair):
            if limit is not None: command += ['-X', '%s=%d' % (name, limit)]
        command += script.split()
        # (Of the many cases of this one, each process goes through its share.)
        if script == 'dict_bulk_paths.py': command += [str(len(limits) // 2), str(number % (len(limits) // 2))]
        running.append((pair, subprocess.Popen(command, env=dict(os.environ, PYTHONHASHSEED='0'), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)))
    for pair, process in running:
        out, err = process.communicate()
        print(script, pair, process.returncode, len(out.splitlines()), hashlib.sha256(out.encode()).hexdigest()[:16], err[-500:])
