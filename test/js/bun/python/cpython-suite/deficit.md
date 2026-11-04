| tests | share | cause | mostly in |
|---|---|---|---|
| 1654 | 38.1% | everything else (individual failures) | test_decimal (350), test_shelve (168), test_uuid (55), test_array (55), test_inspect.test_inspect (48), test_sys (45) |
| 611 | 14.1% | no fork (multiprocessing fork and forkserver, os.fork) | test_multiprocessing_forkserver.test_processes (163), test_multiprocessing_fork.test_processes (101), test_multiprocessing_forkserver.test_misc (83), test_multiprocessing_forkserver.test_threads (78), test_multiprocessing_forkserver.test_manager (69), test_multiprocessing_fork.test_manager (69) |
| 606 | 14.0% | no subinterpreters (_interpreters, InterpreterPoolExecutor) | test_crossinterp (101), test_interpreters.test_api (99), test_concurrent_futures.test_process_pool (79), test__interpchannels (68), test__interpreters (66), test_interpreters.test_channels (35) |
| 382 | 8.8% | needs _testcapi, _testinternalcapi, _testlimitedcapi, _testbuffer, ... (C extensions for tests) | test_call (182), test_opcache (83), test_buffer (80), test_xxlimited (12), test_type_cache (12), test_optimizer (5) |
| 375 | 8.6% | CPython's bytecode: dis, .pyc, marshal of code, code.replace, peephole optimizer | test_dis (145), test_peepholer (122), test_compile (59), test_code (32), test_marshal (14), test_zipimport (3) |
| 237 | 5.5% | no _remote_debugging (sampling profiler, external inspection) | test_profiling.test_sampling_profiler.test_binary_format (84), test_external_inspection (64), test_profiling.test_sampling_profiler.test_children (31), test_profiling.test_sampling_profiler.test_integration (21), test_profiling.test_sampling_profiler.test_modes (15), test_gc_stats (7) |
| 210 | 4.8% | tracebacks: no column ranges (carets), suggestions, formatting by the C printer | test_traceback (196), test_exceptions (13), test_exception_group (1) |
| 173 | 4.0% | no tracing: sys.settrace, sys.setprofile, sys.monitoring, pdb, bdb, trace | test_sys_settrace (82), test_remote_pdb (48), test_monitoring (27), test_pdb (9), test_trace (2), test_sys_setprofile (2) |
| 61 | 1.4% | everything else (skipped) | test_dbm_gnu (19), test_readline (16), test_dbm_ndbm (16), test_perf_profiler (10) |
| 26 | 0.6% | no _datetime: the half of test_datetime that is for the C implementation; test_types imports it | test_datetime (24), test_types (2) |
| 4 | 0.1% | no _asyncio: the halves of the asyncio tests that are for the C implementation | test_asyncio.test_tasks (2), test_asyncio.test_futures2 (2) |
| 2 | 0.0% | no CJK codecs (_multibytecodec, _codecs_*) | test_zipfile.test_core (1), test_multibytecodec (1) |

4341 tests in all that CPython passes here and Bun does not.
