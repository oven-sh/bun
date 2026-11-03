| tests | share | cause | mostly in |
|---|---|---|---|
| 1397 | 13.6% | everything else (individual failures) | test_inspect.test_inspect (73), test_array (55), test_sys (51), test_warnings (38), test_multiprocessing_spawn.test_misc (37), test_builtin (37) |
| 1232 | 12.0% | helpers of test_importlib import _testmultiphase (a C extension) | test_compileall (139), test_import (125), test_importlib.test_util (120), test_importlib.test_spec (106), test_importlib.test_abc (105), test_importlib.source.test_file_loader (61) |
| 1027 | 10.0% | no _asyncio: the halves of the asyncio tests that are for the C implementation | test_asyncio.test_tasks (821), test_asyncio.test_futures (125), test_asyncio.test_eager_task_factory (48), test_asyncio.test_graph (14), test_asyncio.test_free_threading (12), test_asyncio.test_futures2 (7) |
| 873 | 8.5% | no tracing: sys.settrace, sys.setprofile, sys.monitoring, pdb, bdb, trace | test_sys_settrace (434), test_pdb (220), test_monitoring (90), test_remote_pdb (48), test_bdb (31), test_sys_setprofile (25) |
| 810 | 7.9% | needs _testcapi, _testinternalcapi, _testlimitedcapi, _testbuffer, ... (C extensions for tests) | test_bytes (331), test_call (182), test_opcache (83), test_buffer (80), test_with (55), test_class (42) |
| 779 | 7.6% | no subinterpreters (_interpreters, InterpreterPoolExecutor) | test_concurrent_futures.test_process_pool (121), test_crossinterp (101), test_interpreters.test_api (99), test__interpchannels (68), test__interpreters (66), test_concurrent_futures.test_shutdown (51) |
| 773 | 7.5% | no CJK codecs (_multibytecodec, _codecs_*) | test_zipfile.test_core (330), test_codecencodings_jp (133), test_codecencodings_iso2022 (94), test_codecencodings_cn (74), test_codecencodings_kr (57), test_multibytecodec (38) |
| 711 | 6.9% | no _datetime: the half of test_datetime that is for the C implementation; test_types imports it | test_datetime (576), test_types (135) |
| 662 | 6.5% | no _lzma, _bz2 | test_zoneinfo.test_zoneinfo (226), test_tarfile (213), test_lzma (120), test_bz2 (101), test_shutil (2) |
| 645 | 6.3% | no fork (multiprocessing fork and forkserver, os.fork) | test_multiprocessing_forkserver.test_processes (163), test_multiprocessing_fork.test_processes (108), test_multiprocessing_forkserver.test_misc (83), test_multiprocessing_forkserver.test_threads (78), test_multiprocessing_forkserver.test_manager (69), test_multiprocessing_fork.test_manager (69) |
| 481 | 4.7% | no _remote_debugging (sampling profiler, external inspection) | test_profiling.test_sampling_profiler.test_collectors (114), test_profiling.test_sampling_profiler.test_binary_format (79), test_external_inspection (64), test_profiling.test_sampling_profiler.test_cli (55), test_profiling.test_sampling_profiler.test_children (32), test_profiling.test_sampling_profiler.test_profiler (29) |
| 415 | 4.1% | CPython's bytecode: dis, .pyc, marshal of code, code.replace, peephole optimizer | test_dis (145), test_peepholer (129), test_compile (82), test_code (35), test_marshal (15), test_zipimport (6) |
| 289 | 2.8% | tracebacks: no column ranges (carets), suggestions, formatting by the C printer | test_traceback (257), test_exceptions (22), test_cmd_line_script (9), test_exception_group (1) |
| 136 | 1.3% | a test crashes or hangs and takes others with it | test_gc (41), test_descr (32), test_set (26), test_str (12), test_lazy_import (11), test_type_annotations (4) |
| 10 | 0.1% | everything else (skipped) | test_perf_profiler (10) |
| 1 | 0.0% | everything else (the module fails to import) | test_stringprep (1) |

10241 tests in all that CPython passes here and Bun does not.
