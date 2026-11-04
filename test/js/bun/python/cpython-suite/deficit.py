#!/usr/bin/env python3
"""deficit.py [score.json [oracle.json]]: where the tests are that CPython passes and Bun does not, by root cause (rules on the module's name and on why it did not run)."""
import collections, json, os, re, sys
from score import matched
HERE = os.path.dirname(os.path.abspath(__file__))
m = json.load(open(sys.argv[1] if len(sys.argv) > 1 else HERE + '/score.json'))['modules']
o = json.load(open(sys.argv[2] if len(sys.argv) > 2 else HERE + '/oracle.json'))['modules']
RULES = [
    ("no fork (multiprocessing fork and forkserver, os.fork)", r"^test_multiprocessing_fork|^test_fork1|^test_pty|^test_forkserver", r"os\.fork|requires working os.fork"),
    ("no subinterpreters (_interpreters, InterpreterPoolExecutor)", r"^test_interpreters|^test__interp|^test_crossinterp|^test_concurrent_futures", r"_interpreters|_interpchannels|_interpqueues|InterpreterPoolExecutor"),
    ("helpers of test_importlib import _testmultiphase (a C extension)", None, r"_testmultiphase"),
    ("needs _testcapi, _testinternalcapi, _testlimitedcapi, _testbuffer, ... (C extensions for tests)", r"^test_call$|^test_buffer$|^test_opcache|^test_optimizer|^test_xxlimited|^test_stable_abi|^test_type_cache|^test_perfmaps|^test_c_stack", r"_testcapi|_testinternalcapi|_testlimitedcapi|_testbuffer|_testclinic|_xxtestfuzz|xxlimited|_testsinglephase"),
    ("no tracing: sys.settrace, sys.setprofile, sys.monitoring, pdb, bdb, trace", r"^test_sys_settrace|^test_sys_setprofile|^test_monitoring|^test_pdb|^test_bdb|^test_trace$|^test_remote_pdb|^test_cprofile|^test_profile$|^test_pstats|^test_doctest", None),
    ("no _remote_debugging (sampling profiler, external inspection)", r"^test_profiling|^test_external_inspection|^test_gc_stats|^test_asyncio.test_tools", r"_remote_debugging"),
    ("no _asyncio: the halves of the asyncio tests that are for the C implementation", r"^test_asyncio\.(test_tasks|test_futures|test_futures2|test_eager_task_factory|test_free_threading|test_graph)", r"_CTask|_asyncio"),
    ("no _datetime: the half of test_datetime that is for the C implementation; test_types imports it", r"^test_datetime|^test_types$", r"_datetime"),
    ("no CJK codecs (_multibytecodec, _codecs_*)", r"^test_codecencodings|^test_codecmaps|^test_multibytecodec|^test_zipfile\.test_core|^test_email.test_asian", r"shift_jis|_multibytecodec|unknown encoding"),
    ("CPython's bytecode: dis, .pyc, marshal of code, code.replace, peephole optimizer", r"^test_dis$|^test_zipimport|^test_peepholer|^test_compileall|^test_py_compile|^test_code$|^test_compile$|^test_marshal|^test_importlib\.source|^test_opcodes|^test__opcode|^test_pkgutil|^test_zipapp", r"unmarshallable|co_linetable|code\.replace"),
    ("tracebacks: no column ranges (carets), suggestions, formatting by the C printer", r"^test_traceback|^test_exceptions$|^test_exception_group|^test_cmd_line_script", None),
    ("a test crashes or hangs and takes others with it", None, r"^crash: |^hang: "),
]
groups = collections.Counter(); members = collections.defaultdict(list)
for n, r in m.items():
    d = o.get(n, {}).get('passed', 0) - matched(r, o.get(n, {}))
    if d <= 0:
        continue
    reason = r.get('reason') or ''
    for label, name_rule, reason_rule in RULES:
        if (reason_rule and re.search(reason_rule, reason)) or (name_rule and re.search(name_rule, n)):
            break
    else:
        label = "everything else (%s)" % ("the module fails to import" if r['status'] == 'no result' else "skipped" if r['status'] == 'skipped' else "individual failures")
    groups[label] += d; members[label].append((d, n))
total = sum(groups.values())
print("| tests | share | cause | mostly in |\n|---|---|---|---|")
for label, d in groups.most_common():
    top = ", ".join("%s (%d)" % (n, x) for x, n in sorted(members[label], reverse=True)[:6])
    print("| %d | %.1f%% | %s | %s |" % (d, 100 * d / total, label, top))
print("\n%d tests in all that CPython passes here and Bun does not." % total)
