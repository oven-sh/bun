# CPython's test suite under Bun

Run of 2026-11-04 03:06 with `python3`, 2 at a time, 900 s a module; took 796 s, on a heavily loaded machine.

## Totals

| modules | failed | no result | passed | skipped |
|---|---|---|---|---|
| 724 | 114 | 1 | 496 | 113 |

| tests run | passed | failed | errors | skipped |
|---|---|---|---|---|
| 46814 | 42316 | 224 | 408 | 3866 |

CPython itself, on this machine, in the same harness, passes 46643 tests in these modules: 42302 of them pass here, **90.7%**. Another 14 pass here that CPython fails or skips there: they do not count.

## Modules that could not be run at all (1), by cause

| cause | modules | which |
|---|---|---|
| not implemented | 1 | test_dis |

## Failing tests by cause (632)

| cause | tests | mostly in | example |
|---|---|---|---|
| missing attribute of module: os.fork | 181 | test_multiprocessing_fork (91), test_concurrent_futures (85), test_multiprocessing_spawn (3), test_pty (2) | test.test_concurrent_futures.test_as_completed.ProcessPoolForkAsCompletedTest.test_correct_timeout_exception_msg: AttributeError: AttributeError: modu |
| value differs | 162 | test_peepholer (25), test_monitoring (16), test_asyncio (10), test_codecs (10) | test.test_ast.test_ast.ASTConstructorTests.test_non_str_kwarg: AssertionError: TypeError: keywords must be strings |
| missing attribute of module: _remote_debugging.BinaryWriter | 74 | test_profiling (74) | test.test_profiling.test_sampling_profiler.test_binary_format.TestBinaryEdgeCases.test_binary_collector_stops_gracefully_on_overflow: AttributeError:  |
| not implemented | 18 | test_code (6), test_ctypes (5), test_ssl (3), test_marshal (2) | test.test_code.CodeTest.test_code_equality: NotImplementedError: NotImplementedError: code.replace() cannot change co_linetable |
| exception not raised | 17 | test_ordered_dict (6), test_bz2 (2), test_zoneinfo (2), test_code (1) | test.test_bz2.BZ2CompressorTest.testPickle: AssertionError: AssertionError: TypeError not raised |
| concurrent.futures.interpreter.BrokenInt | 17 | test_concurrent_futures (17) | test.test_concurrent_futures.test_init.InterpreterPoolInitializerTest.test_initializer: concurrent.futures.interpreter.BrokenInterpreterPool: concurre |
| RuntimeError | 15 | test_subprocess (7), test_cmd_line (4), test_code (2), test_platform (1) | test.test_cmd_line.CmdLineTest.test_no_std_streams: RuntimeError: RuntimeError: preexec_fn not supported |
| OSError | 14 | test_build_details (10), test_os (2), test_sysconfig (1), test_tempfile (1) | test.test_build_details.CPythonBuildDetailsTests.test_base_interpreter: FileNotFoundError: FileNotFoundError: [Errno 2] No such file or directory: '/m |
| child process | 13 | test_multiprocessing_fork (4), test_concurrent_futures (3), test_multiprocessing_spawn (2), test_datetime (1) | test.test_concurrent_futures.test_interpreter_pool.InterpreterPoolExecutorTest.test_init_with___main___global: AssertionError: AssertionError: Process |
| missing module: importlib.metadata | 12 | test_importlib (12) | test.test_importlib.import_.test_path.Frozen_FindModuleTests.test_invalidate_caches_clear_out_None: ModuleNotFoundError: ModuleNotFoundError: No modul |
| ? | 12 | test_multiprocessing_fork (11), test_tokenize (1) | setUpClass (test.test_multiprocessing_fork.test_manager.WithManagerTestBarrier):  |
| missing attribute of type: NoneType.exc_type | 9 | test_io (8), test_frame (1) | test.test_frame.TestIncompleteFrameAreInvisible.test_entry_frames_are_invisible_during_teardown: AttributeError: AttributeError: 'NoneType' object has |
| warnings expected or unexpected | 7 | test_asyncio (4), test_coroutines (1), test_subprocess (1), test_warnings (1) | test.test_asyncio.test_events.EPollEventLoopTests.test_run_until_complete_nesting: AssertionError: AssertionError: RuntimeWarning not triggered |
| ValueError | 6 | test_ctypes (4), test_mmap (1), test_multiprocessing_spawn (1) | test.test_ctypes.test_prototypes.WCharPointersTestCase.test_POINTER_c_wchar_arg: ValueError: ValueError: character U+88f26dc0 is not in range [U+0000; |
| missing attribute of module: unittest.mock | 6 | test_importlib (6) | test.test_importlib.source.test_file_loader.Frozen_SimpleTest.test_overridden_checked_hash_based_pyc: AttributeError: AttributeError: module 'unittest |
| weak references, finalizers, reference counts | 5 | test_asyncio (2), test_context (1), test_contextlib (1), test_subprocess (1) | test.test_asyncio.test_ssl.TestSSL.test_create_connection_memory_leak: AssertionError: AssertionError: <ssl.SSLContext object at 0x20b74283ce0> is not |
| AttributeError | 5 | test_ctypes (4), test_frame (1) | test.test_ctypes.test_pointers.PointersTestCase.test_pointer_proto_missing_argtypes_error: AttributeError: AttributeError: python3: undefined symbol:  |
| subtest (protocol=0) | 4 | test_io (4) | test.test_io.test_bufferedio.CBufferedRandomTest.test_pickling_subclass: subtest (protocol=0) |
| _interpqueues.QueueError | 3 | test_concurrent_futures (3) | test.test_concurrent_futures.test_interpreter_pool.InterpreterPoolExecutorTest.test_blocking: _interpqueues.QueueError: _interpqueues.QueueError: _int |
| KeyError | 3 | test_hash (3) | test.test_hash.BytesHashRandomizationTests.test_null_hash: KeyError: KeyError: 'wtf' |
| missing attribute of module: pathlib.types | 3 | test_pathlib (3) | test.test_pathlib.test_pathlib.PathSubclassTest.test_matches_writablepath_docstrings: AttributeError: AttributeError: module 'pathlib' has no attribut |
| TypeError | 3 | test_tracemalloc (2), test_sysconfig (1) | test.test_sysconfig.TestSysConfig.test_ldshared_value: TypeError: TypeError: argument of type 'NoneType' is not a container or iterable |
| subtest (str='\U000103ff') | 2 | test_codeccallbacks (2) | test.test_codeccallbacks.CodecCallbackTest.test_badandgoodbackslashreplaceexceptions: subtest (str='\U000103ff') |
| subtest (func=<function TestSpecifics.te | 2 | test_compile (2) | test.test_compile.TestSpecifics.test_lineno_after_no_code: subtest (func=<function TestSpecifics.test_lineno_after_no_code.<locals>.no_code1 at 0x3a7b |
| IndexError | 2 | test_compile (1), test_tracemalloc (1) | test.test_compile.TestSpecifics.test_folding_type_param: IndexError: IndexError: tuple index out of range |
| subtest (buffersize=1) | 2 | test_concurrent_futures (2) | test.test_concurrent_futures.test_interpreter_pool.InterpreterPoolExecutorTest.test_map_buffersize: subtest (buffersize=1) |
| missing attribute of module: _remote_debugging.BinaryReader | 2 | test_profiling (2) | test.test_profiling.test_sampling_profiler.test_binary_format.TestBinaryEdgeCases.test_invalid_file_path: AttributeError: AttributeError: module '_rem |
| subtest (cls='Plain') | 1 | test_class (1) | test.test_class.TestInlineValues.test_both_flags_for_regular_class: subtest (cls='Plain') |
| subtest (encoding='utf-8', str='\U000103 | 1 | test_codeccallbacks (1) | test.test_codeccallbacks.CodecCallbackTest.test_badandgoodsurrogatepassexceptions: subtest (encoding='utf-8', str='\U000103ff', bytes=b'\xed\xa0\x80\x |
| subtest [\ | 1 | test_compile (1) | test.test_compile.TestSpecifics.test_compare_positions: subtest [\ |
| subtest (func='foo') | 1 | test_compile (1) | test.test_compile.TestSpecifics.test_imported_load_method: subtest (func='foo') |
| subtest [0.1] | 1 | test_concurrent_futures (1) | test.test_concurrent_futures.test_as_completed.InterpreterPoolAsCompletedTest.test_future_times_out: subtest [0.1] |
| TimeoutError | 1 | test_concurrent_futures (1) | test.test_concurrent_futures.test_interpreter_pool.InterpreterPoolExecutorTest.test_init_func: TimeoutError: TimeoutError: nothing to read |
| missing module: email | 1 | test_importlib (1) | test.test_importlib.test_namespace_pkgs.SeparatedNamespacePackagesCreatedWhileRunning.test_invalidate_caches: ModuleNotFoundError: ModuleNotFoundError |
| missing module: _testcapi | 1 | test_inspect (1) | test.test_inspect.test_inspect.TestModuleCLI.test_get_cli_details_for_extension_module: ModuleNotFoundError: ModuleNotFoundError: No module named '_te |
| subtest (local=False, line_tool=2, instr | 1 | test_monitoring (1) | test.test_monitoring.TestLineAndInstructionEvents.test_disable_line_keeps_instruction_events: subtest (local=False, line_tool=2, instr_tool=2) |
| subtest (call_method=True) | 1 | test_monitoring (1) | test.test_monitoring.TestLoadSuperAttr.test_vs_other_type_call: subtest (call_method=True) |
| subtest (use_simple_format=False) | 1 | test_multiprocessing_spawn (1) | test.test_multiprocessing_spawn.test_processes.WithProcessesTestSharedMemory.test_shared_memory_SharedMemoryManager_reuses_resource_tracker: subtest ( |
| subtest (line='a in [1,2,3]') | 1 | test_peepholer (1) | test.test_peepholer.TestTranforms.test_constant_folding_lists_of_constants: subtest (line='a in [1,2,3]') |
| subtest (line='a in {1,2,3}') | 1 | test_peepholer (1) | test.test_peepholer.TestTranforms.test_constant_folding_sets_of_constants: subtest (line='a in {1,2,3}') |
| subtest (expr='(0, )[0]', oparg=0) | 1 | test_peepholer (1) | test.test_peepholer.TestTranforms.test_constant_folding_small_int: subtest (expr='(0, )[0]', oparg=0) |
| subtest (expr='-0', is_optimized=True) | 1 | test_peepholer (1) | test.test_peepholer.TestTranforms.test_constant_folding_unaryop: subtest (expr='-0', is_optimized=True) |
| subtest (line='not a is b') | 1 | test_peepholer (1) | test.test_peepholer.TestTranforms.test_elim_inversion_of_is_or_in: subtest (line='not a is b') |
| subtest (line='a, b = a, b') | 1 | test_peepholer (1) | test.test_peepholer.TestTranforms.test_pack_unpack: subtest (line='a, b = a, b') |
| subtest [*_, b, c] | 1 | test_peepholer (1) | test.test_peepholer.TestTranforms.test_static_swaps_match_sequence: subtest [*_, b, c] |
| subtest (path_type='str') | 1 | test_profiling (1) | test.test_profiling.test_sampling_profiler.test_binary_format.TestBinaryEdgeCases.test_path_arguments_round_trip: subtest (path_type='str') |
| subtest (filename='/path/with spaces/fil | 1 | test_profiling (1) | test.test_profiling.test_sampling_profiler.test_binary_format.TestBinaryEdgeCases.test_special_char_filenames: subtest (filename='/path/with spaces/fi |
| subtest (funcname='<lambda>') | 1 | test_profiling (1) | test.test_profiling.test_sampling_profiler.test_binary_format.TestBinaryEdgeCases.test_special_funcnames: subtest (funcname='<lambda>') |
| subtest (filename='/путь/файл.py') | 1 | test_profiling (1) | test.test_profiling.test_sampling_profiler.test_binary_format.TestBinaryEdgeCases.test_unicode_filenames: subtest (filename='/путь/файл.py') |
| subtest (funcname='функция') | 1 | test_profiling (1) | test.test_profiling.test_sampling_profiler.test_binary_format.TestBinaryEdgeCases.test_unicode_funcnames: subtest (funcname='функция') |
| subtest (compression=0) | 1 | test_profiling (1) | test.test_profiling.test_sampling_profiler.test_binary_format.TestBinaryEdgeCases.test_writer_finalizes_after_format_limit: subtest (compression=0) |
| subtest (interval=100) | 1 | test_profiling (1) | test.test_profiling.test_sampling_profiler.test_binary_format.TestBinaryRoundTrip.test_sample_interval_preserved: subtest (interval=100) |
| MemoryError | 1 | test_random (1) | test.test_random.MersenneTwister_TestBasicOps.test_getrandbits_2G_bits: MemoryError: MemoryError |
| message differs | 1 | test_ssl (1) | test.test_ssl.ThreadedTests.test_sni_callback_raising: AssertionError: AssertionError: Regex didn't match: '(TLS_ALERT_HANDSHAKE_FAILURE\|SSLV3_ALERT_H |
| missing module: _interpreters | 1 | test_syslog (1) | test.test_syslog.Test.test_subinterpreter_concurrent_syslog: ModuleNotFoundError: ModuleNotFoundError: Standard library module '_interpreters' was not |
| threads | 1 | test_threading (1) | test.test_threading.ThreadTests.test_no_refcycle_through_target: AssertionError: AssertionError: <test.test_threading.ThreadTests.test_no_refcycle_thr |
| missing attribute of module: _datetime.datetime_CAPI | 1 | test_types (1) | test.test_types.TypesTests.test_capsule_type: AttributeError: AttributeError: module '_datetime' has no attribute 'datetime_CAPI' |
| subtest (attr_name='args') | 1 | test_typing (1) | test.test_typing.ParamSpecTests.test_args_kwargs_weakrefs: subtest (attr_name='args') |
| subtest (LC_ALL='C') | 1 | test_utf8_mode (1) | test.test_utf8_mode.UTF8ModeTests.test_cmd_line: subtest (LC_ALL='C') |
| missing attribute of type: int._from_cache | 1 | test_zoneinfo (1) | test.test_zoneinfo.test_zoneinfo.CZoneInfoCacheTest.test_inconsistent_weak_cache_setdefault: AttributeError: AttributeError: 'int' object has no attri |

## Since the last run

Tests passed: 42316 -> 42316.

## All modules

| module | status | ran | passed | failed | errors | skipped | CPython passes | of which here | seconds | reason |
|---|---|---|---|---|---|---|---|---|---|---|
| test___all__ | passed | 1 | 1 | 0 | 0 | 0 | 1 | 1 | 4.1 |  |
| test__colorize | passed | 8 | 6 | 0 | 0 | 2 | 7 | 6 | 1.9 |  |
| test__interpchannels | skipped | 0 | 0 | 0 | 0 | 0 | 68 | 0 | 0.3 | No module named '_interpchannels' |
| test__interpreters | skipped | 0 | 0 | 0 | 0 | 0 | 66 | 0 | 0.3 | No module named '_interpreters' |
| test__locale | passed | 6 | 0 | 0 | 0 | 6 | 0 | 0 | 0.3 |  |
| test__opcode | passed | 7 | 7 | 0 | 0 | 0 | 7 | 7 | 0.3 |  |
| test__osx_support | passed | 16 | 0 | 0 | 0 | 16 | 0 | 0 | 0.5 |  |
| test_abc | passed | 76 | 76 | 0 | 0 | 0 | 76 | 76 | 0.6 |  |
| test_abstract_numbers | passed | 7 | 7 | 0 | 0 | 0 | 7 | 7 | 0.3 |  |
| test_annotationlib | passed | 120 | 119 | 0 | 0 | 1 | 120 | 119 | 0.5 |  |
| test_argparse | passed | 1963 | 1963 | 0 | 0 | 0 | 1962 | 1962 | 7.9 |  |
| test_array | passed | 1098 | 1043 | 0 | 0 | 55 | 1098 | 1043 | 3.4 |  |
| test_asdl_parser | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | test irrelevant for an installed Python |
| test_ast.test_ast | failed | 220 | 209 | 2 | 0 | 9 | 218 | 209 | 1.2 |  |
| test_asyncgen | passed | 85 | 85 | 0 | 0 | 0 | 85 | 85 | 1.9 |  |
| test_asyncio.test_base_events | passed | 118 | 118 | 0 | 0 | 0 | 118 | 118 | 4.2 |  |
| test_asyncio.test_buffered_proto | passed | 2 | 1 | 0 | 0 | 1 | 1 | 1 | 0.4 |  |
| test_asyncio.test_context | passed | 1 | 1 | 0 | 0 | 0 | 1 | 1 | 0.7 |  |
| test_asyncio.test_eager_task_factory | passed | 48 | 48 | 0 | 0 | 0 | 48 | 48 | 6.3 |  |
| test_asyncio.test_events | failed | 309 | 306 | 3 | 0 | 0 | 309 | 306 | 41.4 |  |
| test_asyncio.test_free_threading | passed | 24 | 24 | 0 | 0 | 0 | 24 | 24 | 3.6 |  |
| test_asyncio.test_futures | passed | 189 | 189 | 0 | 0 | 0 | 189 | 189 | 2.1 |  |
| test_asyncio.test_futures2 | failed | 7 | 5 | 2 | 0 | 0 | 7 | 5 | 1.0 |  |
| test_asyncio.test_graph | passed | 28 | 28 | 0 | 0 | 0 | 28 | 28 | 1.2 |  |
| test_asyncio.test_locks | passed | 75 | 75 | 0 | 0 | 0 | 75 | 75 | 2.8 |  |
| test_asyncio.test_pep492 | passed | 11 | 11 | 0 | 0 | 0 | 11 | 11 | 11.0 |  |
| test_asyncio.test_proactor_events | passed | 82 | 78 | 0 | 0 | 4 | 78 | 78 | 2.4 |  |
| test_asyncio.test_protocols | passed | 5 | 5 | 0 | 0 | 0 | 5 | 5 | 0.5 |  |
| test_asyncio.test_queues | passed | 59 | 59 | 0 | 0 | 0 | 59 | 59 | 0.8 |  |
| test_asyncio.test_runners | failed | 30 | 29 | 1 | 0 | 0 | 30 | 29 | 1.0 |  |
| test_asyncio.test_selector_events | passed | 131 | 131 | 0 | 0 | 0 | 131 | 131 | 0.9 |  |
| test_asyncio.test_sendfile | passed | 66 | 66 | 0 | 0 | 0 | 66 | 66 | 8.2 |  |
| test_asyncio.test_server | passed | 13 | 12 | 0 | 0 | 1 | 12 | 12 | 2.1 |  |
| test_asyncio.test_server_context | passed | 12 | 12 | 0 | 0 | 0 | 12 | 12 | 1.2 |  |
| test_asyncio.test_sock_lowlevel | passed | 45 | 45 | 0 | 0 | 0 | 45 | 45 | 11.4 |  |
| test_asyncio.test_ssl | failed | 24 | 20 | 2 | 0 | 2 | 22 | 20 | 18.1 |  |
| test_asyncio.test_sslproto | failed | 40 | 25 | 2 | 0 | 13 | 27 | 25 | 6.0 |  |
| test_asyncio.test_staggered | passed | 7 | 7 | 0 | 0 | 0 | 7 | 7 | 0.8 |  |
| test_asyncio.test_streams | failed | 76 | 75 | 1 | 0 | 0 | 76 | 75 | 1.6 |  |
| test_asyncio.test_subprocess | passed | 86 | 86 | 0 | 0 | 0 | 86 | 86 | 12.8 |  |
| test_asyncio.test_taskgroups | failed | 130 | 126 | 4 | 0 | 0 | 130 | 126 | 13.4 |  |
| test_asyncio.test_tasks | failed | 1133 | 1131 | 1 | 0 | 1 | 1133 | 1131 | 18.0 |  |
| test_asyncio.test_threads | passed | 6 | 6 | 0 | 0 | 0 | 6 | 6 | 0.6 |  |
| test_asyncio.test_timeouts | passed | 34 | 34 | 0 | 0 | 0 | 34 | 34 | 1.0 |  |
| test_asyncio.test_tools | passed | 22 | 22 | 0 | 0 | 0 | 22 | 22 | 0.4 |  |
| test_asyncio.test_transports | passed | 7 | 7 | 0 | 0 | 0 | 7 | 7 | 0.4 |  |
| test_asyncio.test_unix_events | passed | 90 | 85 | 0 | 0 | 5 | 90 | 85 | 0.8 |  |
| test_asyncio.test_waitfor | passed | 19 | 19 | 0 | 0 | 0 | 19 | 19 | 1.4 |  |
| test_asyncio.test_windows_events | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.5 | Windows only |
| test_asyncio.test_windows_utils | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.4 | Windows only |
| test_atexit | passed | 10 | 4 | 0 | 0 | 6 | 9 | 4 | 2.0 |  |
| test_audit | failed | 33 | 24 | 3 | 0 | 6 | 29 | 24 | 6.4 |  |
| test_augassign | passed | 7 | 7 | 0 | 0 | 0 | 7 | 7 | 0.4 |  |
| test_base64 | passed | 67 | 66 | 0 | 0 | 1 | 67 | 66 | 1.0 |  |
| test_baseexception | passed | 11 | 11 | 0 | 0 | 0 | 11 | 11 | 0.3 |  |
| test_bdb | failed | 37 | 36 | 1 | 0 | 0 | 37 | 36 | 0.6 |  |
| test_bigaddrspace | passed | 6 | 0 | 0 | 0 | 6 | 0 | 0 | 0.3 |  |
| test_bigmem | passed | 166 | 165 | 0 | 0 | 1 | 166 | 165 | 0.5 |  |
| test_binascii | passed | 237 | 220 | 0 | 0 | 17 | 220 | 220 | 0.5 |  |
| test_binop | passed | 12 | 12 | 0 | 0 | 0 | 12 | 12 | 0.4 |  |
| test_bisect | passed | 46 | 46 | 0 | 0 | 0 | 46 | 46 | 0.3 |  |
| test_bool | passed | 31 | 31 | 0 | 0 | 0 | 31 | 31 | 0.4 |  |
| test_buffer | passed | 97 | 15 | 0 | 0 | 82 | 95 | 15 | 0.5 |  |
| test_build_details | failed | 17 | 6 | 1 | 10 | 0 | 10 | 0 | 0.4 |  |
| test_builtin | passed | 157 | 143 | 0 | 0 | 14 | 149 | 143 | 1.0 |  |
| test_bytes | passed | 339 | 324 | 0 | 0 | 15 | 331 | 324 | 6.6 |  |
| test_bz2 | failed | 102 | 99 | 2 | 0 | 1 | 101 | 99 | 2.1 |  |
| test_c_locale_coercion | passed | 8 | 2 | 0 | 0 | 6 | 7 | 2 | 1.6 |  |
| test_c_stack_unwind | skipped | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0.4 | No module named '_testinternalcapi' |
| test_calendar | passed | 86 | 81 | 0 | 0 | 5 | 81 | 81 | 7.0 |  |
| test_call | passed | 189 | 7 | 0 | 0 | 182 | 189 | 7 | 0.4 |  |
| test_charmapcodec | passed | 4 | 4 | 0 | 0 | 0 | 4 | 4 | 0.4 |  |
| test_class | failed | 42 | 31 | 1 | 0 | 10 | 42 | 31 | 0.4 |  |
| test_cmath | passed | 33 | 32 | 0 | 0 | 1 | 33 | 32 | 0.4 |  |
| test_cmd | passed | 5 | 4 | 0 | 0 | 1 | 7 | 4 | 0.4 |  |
| test_cmd_line | failed | 82 | 49 | 2 | 4 | 27 | 69 | 49 | 12.4 |  |
| test_cmd_line_script | passed | 51 | 51 | 0 | 0 | 0 | 51 | 51 | 10.5 |  |
| test_code | failed | 37 | 9 | 1 | 8 | 19 | 41 | 9 | 0.8 |  |
| test_code_module | passed | 18 | 18 | 0 | 0 | 0 | 18 | 18 | 0.5 |  |
| test_codeccallbacks | failed | 44 | 40 | 3 | 1 | 0 | 44 | 40 | 0.5 |  |
| test_codecencodings_cn | passed | 76 | 74 | 0 | 0 | 2 | 74 | 74 | 0.5 |  |
| test_codecencodings_hk | passed | 19 | 19 | 0 | 0 | 0 | 19 | 19 | 0.4 |  |
| test_codecencodings_iso2022 | passed | 95 | 94 | 0 | 0 | 1 | 94 | 94 | 0.6 |  |
| test_codecencodings_jp | passed | 133 | 133 | 0 | 0 | 0 | 133 | 133 | 0.7 |  |
| test_codecencodings_kr | passed | 57 | 57 | 0 | 0 | 0 | 57 | 57 | 0.6 |  |
| test_codecencodings_tw | passed | 19 | 19 | 0 | 0 | 0 | 19 | 19 | 0.4 |  |
| test_codecmaps_cn | passed | 9 | 0 | 0 | 0 | 9 | 0 | 0 | 0.4 |  |
| test_codecmaps_hk | passed | 3 | 0 | 0 | 0 | 3 | 0 | 0 | 0.4 |  |
| test_codecmaps_jp | passed | 15 | 0 | 0 | 0 | 15 | 0 | 0 | 0.4 |  |
| test_codecmaps_kr | passed | 9 | 0 | 0 | 0 | 9 | 0 | 0 | 0.4 |  |
| test_codecmaps_tw | passed | 6 | 0 | 0 | 0 | 6 | 0 | 0 | 0.4 |  |
| test_codecs | failed | 288 | 255 | 10 | 0 | 23 | 274 | 255 | 1.8 |  |
| test_codeop | passed | 13 | 13 | 0 | 0 | 0 | 13 | 13 | 0.5 |  |
| test_collections | passed | 120 | 116 | 0 | 0 | 4 | 119 | 116 | 1.1 |  |
| test_colorsys | passed | 8 | 8 | 0 | 0 | 0 | 8 | 8 | 0.7 |  |
| test_compare | passed | 16 | 16 | 0 | 0 | 0 | 16 | 16 | 0.9 |  |
| test_compile | failed | 188 | 128 | 7 | 2 | 51 | 187 | 128 | 2.3 |  |
| test_compileall | passed | 145 | 139 | 0 | 0 | 6 | 139 | 139 | 25.7 |  |
| test_compiler_assemble | passed | 3 | 0 | 0 | 0 | 3 | 3 | 0 | 0.4 |  |
| test_compiler_codegen | passed | 5 | 0 | 0 | 0 | 5 | 5 | 0 | 0.4 |  |
| test_complex | passed | 38 | 37 | 0 | 0 | 1 | 38 | 37 | 0.4 |  |
| test_concurrent_futures.test_as_completed | failed | 25 | 14 | 1 | 5 | 5 | 25 | 14 | 9.6 |  |
| test_concurrent_futures.test_deadlock | failed | 48 | 16 | 0 | 16 | 16 | 48 | 16 | 12.4 |  |
| test_concurrent_futures.test_future | passed | 21 | 21 | 0 | 0 | 0 | 21 | 21 | 3.5 |  |
| test_concurrent_futures.test_init | failed | 12 | 4 | 2 | 3 | 3 | 12 | 4 | 2.6 |  |
| test_concurrent_futures.test_interpreter_pool | failed | 45 | 15 | 5 | 22 | 3 | 42 | 15 | 11.9 |  |
| test_concurrent_futures.test_process_pool | failed | 135 | 42 | 0 | 42 | 51 | 121 | 42 | 23.4 |  |
| test_concurrent_futures.test_shutdown | failed | 48 | 22 | 2 | 12 | 12 | 51 | 22 | 10.0 |  |
| test_concurrent_futures.test_thread_pool | passed | 26 | 22 | 0 | 0 | 4 | 24 | 22 | 0.9 |  |
| test_concurrent_futures.test_wait | failed | 33 | 17 | 0 | 8 | 8 | 33 | 17 | 4.5 |  |
| test_configparser | passed | 383 | 378 | 0 | 0 | 5 | 378 | 378 | 1.9 |  |
| test_contains | passed | 4 | 4 | 0 | 0 | 0 | 4 | 4 | 0.6 |  |
| test_context | failed | 58 | 33 | 1 | 0 | 24 | 57 | 33 | 0.8 |  |
| test_contextlib | failed | 100 | 99 | 1 | 0 | 0 | 100 | 99 | 0.5 |  |
| test_contextlib_async | passed | 70 | 70 | 0 | 0 | 0 | 70 | 70 | 0.5 |  |
| test_copy | passed | 84 | 84 | 0 | 0 | 0 | 84 | 84 | 0.4 |  |
| test_copyreg | passed | 6 | 6 | 0 | 0 | 0 | 6 | 6 | 0.4 |  |
| test_coroutines | failed | 100 | 96 | 1 | 0 | 3 | 100 | 96 | 1.2 |  |
| test_crossinterp | skipped | 0 | 0 | 0 | 0 | 0 | 101 | 0 | 0.4 | No module named '_testinternalcapi' |
| test_csv | passed | 140 | 134 | 0 | 0 | 6 | 136 | 134 | 0.7 |  |
| test_ctypes.test_aligned_structures | passed | 12 | 12 | 0 | 0 | 0 | 12 | 12 | 0.3 |  |
| test_ctypes.test_anon | passed | 5 | 4 | 0 | 0 | 1 | 5 | 4 | 0.3 |  |
| test_ctypes.test_array_in_pointer | passed | 2 | 2 | 0 | 0 | 0 | 2 | 2 | 0.3 |  |
| test_ctypes.test_arrays | passed | 19 | 17 | 0 | 0 | 2 | 17 | 17 | 0.3 |  |
| test_ctypes.test_as_parameter | passed | 40 | 40 | 0 | 0 | 0 | 40 | 40 | 0.3 |  |
| test_ctypes.test_bitfields | passed | 32 | 32 | 0 | 0 | 0 | 32 | 32 | 0.7 |  |
| test_ctypes.test_buffers | passed | 5 | 5 | 0 | 0 | 0 | 5 | 5 | 0.3 |  |
| test_ctypes.test_bytes | passed | 7 | 6 | 0 | 0 | 1 | 6 | 6 | 0.3 |  |
| test_ctypes.test_byteswap | passed | 17 | 17 | 0 | 0 | 0 | 17 | 17 | 0.3 |  |
| test_ctypes.test_c_simple_type_meta | passed | 9 | 9 | 0 | 0 | 0 | 9 | 9 | 0.4 |  |
| test_ctypes.test_callbacks | failed | 29 | 24 | 0 | 3 | 2 | 27 | 24 | 0.4 |  |
| test_ctypes.test_cast | passed | 7 | 7 | 0 | 0 | 0 | 7 | 7 | 0.3 |  |
| test_ctypes.test_cfuncs | passed | 29 | 28 | 0 | 0 | 1 | 28 | 28 | 0.3 |  |
| test_ctypes.test_checkretval | passed | 2 | 1 | 0 | 0 | 1 | 1 | 1 | 0.5 |  |
| test_ctypes.test_delattr | passed | 6 | 6 | 0 | 0 | 0 | 6 | 6 | 0.3 |  |
| test_ctypes.test_dlerror | passed | 5 | 5 | 0 | 0 | 0 | 5 | 5 | 0.6 |  |
| test_ctypes.test_dllist | passed | 2 | 2 | 0 | 0 | 0 | 2 | 2 | 0.3 |  |
| test_ctypes.test_errno | passed | 2 | 1 | 0 | 0 | 1 | 1 | 1 | 0.4 |  |
| test_ctypes.test_find | passed | 14 | 5 | 0 | 0 | 9 | 5 | 5 | 1.6 |  |
| test_ctypes.test_frombuffer | passed | 7 | 6 | 0 | 0 | 1 | 7 | 6 | 0.9 |  |
| test_ctypes.test_funcptr | passed | 8 | 8 | 0 | 0 | 0 | 8 | 8 | 0.3 |  |
| test_ctypes.test_functions | failed | 26 | 23 | 0 | 1 | 2 | 24 | 23 | 0.4 |  |
| test_ctypes.test_generated_structs | passed | 1 | 1 | 0 | 0 | 0 | 1 | 1 | 0.5 |  |
| test_ctypes.test_incomplete | passed | 3 | 3 | 0 | 0 | 0 | 3 | 3 | 0.3 |  |
| test_ctypes.test_init | passed | 1 | 1 | 0 | 0 | 0 | 1 | 1 | 0.4 |  |
| test_ctypes.test_internals | failed | 6 | 5 | 1 | 0 | 0 | 6 | 5 | 0.3 |  |
| test_ctypes.test_keeprefs | passed | 8 | 8 | 0 | 0 | 0 | 8 | 8 | 0.3 |  |
| test_ctypes.test_libc | failed | 3 | 2 | 0 | 1 | 0 | 3 | 2 | 0.4 |  |
| test_ctypes.test_loading | passed | 11 | 3 | 0 | 0 | 8 | 3 | 3 | 0.3 |  |
| test_ctypes.test_macholib | passed | 4 | 1 | 0 | 0 | 3 | 1 | 1 | 0.4 |  |
| test_ctypes.test_memfunctions | passed | 8 | 7 | 0 | 0 | 1 | 8 | 7 | 0.3 |  |
| test_ctypes.test_numbers | passed | 19 | 19 | 0 | 0 | 0 | 19 | 19 | 0.3 |  |
| test_ctypes.test_objects | passed | 1 | 1 | 0 | 0 | 0 | 1 | 1 | 0.4 |  |
| test_ctypes.test_parameters | passed | 15 | 13 | 0 | 0 | 2 | 15 | 13 | 0.4 |  |
| test_ctypes.test_pep3118 | passed | 2 | 2 | 0 | 0 | 0 | 2 | 2 | 0.3 |  |
| test_ctypes.test_pickling | passed | 24 | 24 | 0 | 0 | 0 | 24 | 24 | 0.3 |  |
| test_ctypes.test_pointers | failed | 38 | 37 | 0 | 1 | 0 | 38 | 37 | 0.6 |  |
| test_ctypes.test_prototypes | failed | 13 | 11 | 0 | 2 | 0 | 13 | 11 | 0.3 |  |
| test_ctypes.test_python_api | failed | 6 | 1 | 0 | 2 | 3 | 6 | 1 | 0.3 |  |
| test_ctypes.test_random_things | passed | 5 | 4 | 0 | 0 | 1 | 4 | 4 | 0.3 |  |
| test_ctypes.test_refcounts | failed | 6 | 2 | 0 | 1 | 3 | 6 | 2 | 0.5 |  |
| test_ctypes.test_repr | passed | 2 | 2 | 0 | 0 | 0 | 2 | 2 | 0.3 |  |
| test_ctypes.test_returnfuncptrs | passed | 4 | 4 | 0 | 0 | 0 | 4 | 4 | 0.4 |  |
| test_ctypes.test_simplesubclasses | passed | 8 | 8 | 0 | 0 | 0 | 8 | 8 | 0.4 |  |
| test_ctypes.test_sizes | passed | 7 | 7 | 0 | 0 | 0 | 7 | 7 | 0.3 |  |
| test_ctypes.test_slicing | passed | 6 | 6 | 0 | 0 | 0 | 6 | 6 | 0.3 |  |
| test_ctypes.test_stringptr | passed | 3 | 2 | 0 | 0 | 1 | 3 | 2 | 0.3 |  |
| test_ctypes.test_strings | passed | 11 | 11 | 0 | 0 | 0 | 11 | 11 | 0.4 |  |
| test_ctypes.test_struct_fields | passed | 28 | 28 | 0 | 0 | 0 | 28 | 28 | 0.4 |  |
| test_ctypes.test_structunion | passed | 46 | 46 | 0 | 0 | 0 | 46 | 46 | 0.5 |  |
| test_ctypes.test_structures | passed | 20 | 17 | 0 | 0 | 3 | 18 | 17 | 0.6 |  |
| test_ctypes.test_unaligned_structures | passed | 2 | 2 | 0 | 0 | 0 | 2 | 2 | 0.3 |  |
| test_ctypes.test_unicode | passed | 7 | 7 | 0 | 0 | 0 | 7 | 7 | 0.3 |  |
| test_ctypes.test_values | failed | 5 | 3 | 0 | 2 | 0 | 5 | 3 | 0.3 |  |
| test_ctypes.test_varsize_struct | passed | 3 | 3 | 0 | 0 | 0 | 3 | 3 | 0.3 |  |
| test_ctypes.test_win32 | passed | 8 | 1 | 0 | 0 | 7 | 1 | 1 | 0.3 |  |
| test_ctypes.test_win32_com_foreign_func | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | Windows-specific test |
| test_ctypes.test_wintypes | passed | 2 | 2 | 0 | 0 | 0 | 2 | 2 | 0.3 |  |
| test_curses | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | Use of the 'curses' resource not enabled |
| test_dataclasses | passed | 285 | 282 | 0 | 0 | 3 | 285 | 282 | 1.0 |  |
| test_datetime | failed | 1160 | 1103 | 1 | 0 | 56 | 1127 | 1103 | 4.1 |  |
| test_dbm | passed | 38 | 37 | 0 | 0 | 1 | 69 | 37 | 2.0 |  |
| test_dbm_dumb | passed | 28 | 28 | 0 | 0 | 0 | 28 | 28 | 0.5 |  |
| test_dbm_gnu | skipped | 0 | 0 | 0 | 0 | 0 | 19 | 0 | 0.3 | No module named '_gdbm' |
| test_dbm_ndbm | skipped | 0 | 0 | 0 | 0 | 0 | 16 | 0 | 0.3 | No module named '_dbm' |
| test_dbm_sqlite3 | passed | 30 | 29 | 0 | 0 | 1 | 29 | 29 | 2.8 |  |
| test_decimal | passed | 587 | 383 | 0 | 0 | 204 | 733 | 383 | 1.9 |  |
| test_decorators | passed | 16 | 16 | 0 | 0 | 0 | 16 | 16 | 0.4 |  |
| test_defaultdict | passed | 13 | 13 | 0 | 0 | 0 | 13 | 13 | 0.4 |  |
| test_deque | passed | 82 | 79 | 0 | 0 | 3 | 81 | 79 | 1.8 |  |
| test_descr | failed | 168 | 155 | 0 | 0 | 13 | 167 | 155 | 1.4 | exit status 2 |
| test_descrtut | passed | 8 | 8 | 0 | 0 | 0 | 8 | 8 | 0.4 |  |
| test_devpoll | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | test works only on Solaris OS family |
| test_dict | failed | 145 | 132 | 1 | 0 | 12 | 145 | 132 | 1.6 |  |
| test_dictcomps | passed | 10 | 10 | 0 | 0 | 0 | 10 | 10 | 0.3 |  |
| test_dictviews | passed | 16 | 16 | 0 | 0 | 0 | 16 | 16 | 0.5 |  |
| test_difflib | passed | 61 | 60 | 0 | 0 | 1 | 61 | 60 | 1.0 |  |
| test_dis | no result | 0 | 0 | 0 | 0 | 0 | 145 | 0 | 0.3 | NotImplementedError: code.replace() cannot change co_linetable |
| test_doctest.test_doctest | failed | 74 | 74 | 0 | 0 | 0 | 74 | 73 | 3.3 | AssertionError: Failed example: |
| test_doctest.test_doctest2 | passed | 1 | 1 | 0 | 0 | 0 | 1 | 1 | 0.4 |  |
| test_docxmlrpc | passed | 9 | 9 | 0 | 0 | 0 | 9 | 9 | 3.5 |  |
| test_dtrace | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.2 | CPython must be configured with the --with-dtrace option. |
| test_dynamic | passed | 11 | 11 | 0 | 0 | 0 | 11 | 11 | 0.4 |  |
| test_dynamicclassattribute | passed | 12 | 11 | 0 | 0 | 1 | 11 | 11 | 0.4 |  |
| test_eintr | passed | 1 | 0 | 0 | 0 | 1 | 0 | 0 | 0.3 |  |
| test_email.test__encoded_words | passed | 39 | 39 | 0 | 0 | 0 | 39 | 39 | 0.3 |  |
| test_email.test__header_value_parser | passed | 389 | 389 | 0 | 0 | 0 | 389 | 389 | 0.6 |  |
| test_email.test_asian_codecs | passed | 5 | 5 | 0 | 0 | 0 | 5 | 5 | 0.4 |  |
| test_email.test_contentmanager | passed | 116 | 116 | 0 | 0 | 0 | 116 | 116 | 0.5 |  |
| test_email.test_defect_handling | passed | 60 | 60 | 0 | 0 | 0 | 60 | 60 | 0.4 |  |
| test_email.test_email | passed | 542 | 540 | 0 | 0 | 2 | 540 | 540 | 4.4 |  |
| test_email.test_generator | passed | 83 | 83 | 0 | 0 | 0 | 83 | 83 | 0.5 |  |
| test_email.test_headerregistry | passed | 194 | 194 | 0 | 0 | 0 | 194 | 194 | 0.6 |  |
| test_email.test_inversion | passed | 5 | 5 | 0 | 0 | 0 | 5 | 5 | 0.4 |  |
| test_email.test_message | passed | 311 | 311 | 0 | 0 | 0 | 311 | 311 | 0.8 |  |
| test_email.test_parser | passed | 8 | 8 | 0 | 0 | 0 | 8 | 8 | 0.4 |  |
| test_email.test_pickleable | passed | 12 | 12 | 0 | 0 | 0 | 12 | 12 | 0.4 |  |
| test_email.test_policy | passed | 33 | 33 | 0 | 0 | 0 | 33 | 33 | 0.4 |  |
| test_email.test_utils | passed | 21 | 20 | 0 | 0 | 1 | 21 | 20 | 0.4 |  |
| test_ensurepip | passed | 33 | 33 | 0 | 0 | 0 | 33 | 33 | 0.5 |  |
| test_enum | passed | 1089 | 1084 | 0 | 0 | 5 | 1083 | 1082 | 1.6 |  |
| test_enumerate | passed | 105 | 89 | 0 | 0 | 16 | 105 | 89 | 0.4 |  |
| test_eof | failed | 6 | 5 | 1 | 0 | 0 | 6 | 5 | 0.9 |  |
| test_epoll | passed | 11 | 11 | 0 | 0 | 0 | 11 | 11 | 0.4 |  |
| test_errno | passed | 3 | 3 | 0 | 0 | 0 | 3 | 3 | 0.4 |  |
| test_except_star | passed | 60 | 60 | 0 | 0 | 0 | 60 | 60 | 0.3 |  |
| test_exception_group | passed | 54 | 53 | 0 | 0 | 1 | 54 | 53 | 0.9 |  |
| test_exception_hierarchy | passed | 16 | 15 | 0 | 0 | 1 | 15 | 15 | 0.3 |  |
| test_exception_variations | passed | 30 | 30 | 0 | 0 | 0 | 30 | 30 | 0.3 |  |
| test_exceptions | failed | 115 | 99 | 0 | 1 | 15 | 112 | 99 | 3.8 |  |
| test_extcall | passed | 6 | 6 | 0 | 0 | 0 | 6 | 6 | 0.5 |  |
| test_external_inspection | failed | 57 | 0 | 0 | 0 | 57 | 64 | 0 | 0.4 | TypeError: cannot create '_remote_debugging.RemoteUnwinder' instances |
| test_faulthandler | failed | 51 | 39 | 1 | 0 | 11 | 45 | 39 | 15.5 |  |
| test_fcntl | passed | 14 | 11 | 0 | 0 | 3 | 13 | 11 | 0.8 |  |
| test_file_eintr | passed | 18 | 18 | 0 | 0 | 0 | 18 | 18 | 3.4 |  |
| test_filecmp | passed | 16 | 16 | 0 | 0 | 0 | 16 | 16 | 0.9 |  |
| test_fileinput | passed | 57 | 57 | 0 | 0 | 0 | 57 | 57 | 0.4 |  |
| test_fileutils | skipped | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0.3 | No module named '_testinternalcapi' |
| test_finalization | passed | 18 | 13 | 0 | 0 | 5 | 18 | 13 | 0.8 |  |
| test_float | passed | 54 | 51 | 0 | 0 | 3 | 53 | 51 | 0.5 |  |
| test_flufl | passed | 4 | 4 | 0 | 0 | 0 | 4 | 4 | 0.4 |  |
| test_fnmatch | passed | 24 | 24 | 0 | 0 | 0 | 24 | 24 | 0.4 |  |
| test_fork1 | skipped | 0 | 0 | 0 | 0 | 0 | 4 | 0 | 0.3 | test module requires working os.fork |
| test_format | passed | 19 | 16 | 0 | 0 | 3 | 19 | 16 | 0.4 |  |
| test_fractions | passed | 50 | 50 | 0 | 0 | 0 | 50 | 50 | 0.4 |  |
| test_frame | failed | 61 | 48 | 0 | 2 | 11 | 53 | 48 | 1.9 |  |
| test_free_threading.test_bisect | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | GIL enabled |
| test_free_threading.test_bytes_object | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.4 | GIL enabled |
| test_free_threading.test_bz2 | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | GIL enabled |
| test_free_threading.test_capi | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | GIL enabled |
| test_free_threading.test_code | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | GIL enabled |
| test_free_threading.test_collections | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | GIL enabled |
| test_free_threading.test_context | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | GIL enabled |
| test_free_threading.test_cprofile | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | GIL enabled |
| test_free_threading.test_csv | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.2 | GIL enabled |
| test_free_threading.test_datetime | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | GIL enabled |
| test_free_threading.test_dbm_gnu | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.2 | GIL enabled |
| test_free_threading.test_dict | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.4 | GIL enabled |
| test_free_threading.test_dict_watcher | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.2 | GIL enabled |
| test_free_threading.test_enumerate | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.2 | GIL enabled |
| test_free_threading.test_exceptions | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.2 | GIL enabled |
| test_free_threading.test_frame | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.2 | GIL enabled |
| test_free_threading.test_func_annotations | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | GIL enabled |
| test_free_threading.test_functions | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.2 | GIL enabled |
| test_free_threading.test_functools | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | GIL enabled |
| test_free_threading.test_gc | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | GIL enabled |
| test_free_threading.test_generators | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | GIL enabled |
| test_free_threading.test_grp | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | GIL enabled |
| test_free_threading.test_heapq | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.2 | GIL enabled |
| test_free_threading.test_io | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | GIL enabled |
| test_free_threading.test_iteration | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.2 | GIL enabled |
| test_free_threading.test_itertools | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.2 | GIL enabled |
| test_free_threading.test_itertools_combinatoric | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.2 | GIL enabled |
| test_free_threading.test_json | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | GIL enabled |
| test_free_threading.test_list | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.2 | GIL enabled |
| test_free_threading.test_lzma | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.2 | GIL enabled |
| test_free_threading.test_methodcaller | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | GIL enabled |
| test_free_threading.test_mmap | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | GIL enabled |
| test_free_threading.test_monitoring | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | GIL enabled |
| test_free_threading.test_os | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | GIL enabled |
| test_free_threading.test_pickle | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | GIL enabled |
| test_free_threading.test_pwd | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | GIL enabled |
| test_free_threading.test_races | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | GIL enabled |
| test_free_threading.test_re | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | GIL enabled |
| test_free_threading.test_readline | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | GIL enabled |
| test_free_threading.test_resource | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | GIL enabled |
| test_free_threading.test_reversed | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | GIL enabled |
| test_free_threading.test_set | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.2 | GIL enabled |
| test_free_threading.test_slots | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.2 | GIL enabled |
| test_free_threading.test_sqlite3 | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | GIL enabled |
| test_free_threading.test_str | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | GIL enabled |
| test_free_threading.test_string_template_race | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | GIL enabled |
| test_free_threading.test_suggestions | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | GIL enabled |
| test_free_threading.test_sys | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.2 | GIL enabled |
| test_free_threading.test_syslog | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.2 | GIL enabled |
| test_free_threading.test_threading | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.2 | GIL enabled |
| test_free_threading.test_tokenize | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.2 | GIL enabled |
| test_free_threading.test_type | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | GIL enabled |
| test_free_threading.test_types | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | GIL enabled |
| test_free_threading.test_uuid | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | GIL enabled |
| test_free_threading.test_weakref | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | GIL enabled |
| test_free_threading.test_zip | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | GIL enabled |
| test_free_threading.test_zlib | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | GIL enabled |
| test_frozen | passed | 3 | 3 | 0 | 0 | 0 | 3 | 3 | 0.3 |  |
| test_fstring | passed | 96 | 95 | 0 | 0 | 1 | 95 | 95 | 1.2 |  |
| test_ftplib | passed | 96 | 95 | 0 | 0 | 1 | 95 | 95 | 10.6 |  |
| test_funcattrs | passed | 39 | 38 | 0 | 0 | 1 | 39 | 38 | 0.3 |  |
| test_functools | passed | 338 | 335 | 0 | 0 | 3 | 338 | 335 | 2.0 |  |
| test_future_stmt.test_future | passed | 23 | 23 | 0 | 0 | 0 | 23 | 23 | 0.7 |  |
| test_future_stmt.test_future_flags | passed | 2 | 2 | 0 | 0 | 0 | 2 | 2 | 0.3 |  |
| test_future_stmt.test_future_multiple_features | passed | 2 | 2 | 0 | 0 | 0 | 2 | 2 | 0.3 |  |
| test_future_stmt.test_future_multiple_imports | passed | 1 | 1 | 0 | 0 | 0 | 1 | 1 | 0.3 |  |
| test_future_stmt.test_future_single_import | passed | 3 | 3 | 0 | 0 | 0 | 3 | 3 | 0.3 |  |
| test_gc | failed | 61 | 42 | 6 | 0 | 13 | 59 | 42 | 6.5 |  |
| test_gc_stats | passed | 8 | 0 | 0 | 0 | 8 | 7 | 0 | 0.4 |  |
| test_generator_stop | passed | 2 | 2 | 0 | 0 | 0 | 2 | 2 | 0.3 |  |
| test_generators | failed | 59 | 57 | 1 | 0 | 1 | 59 | 57 | 0.7 |  |
| test_genericalias | passed | 37 | 37 | 0 | 0 | 0 | 37 | 37 | 0.4 |  |
| test_genericclass | passed | 22 | 21 | 0 | 0 | 1 | 22 | 21 | 0.4 |  |
| test_genericpath | passed | 26 | 26 | 0 | 0 | 0 | 26 | 26 | 0.3 |  |
| test_genexps | failed | 1 | 1 | 0 | 0 | 0 | 1 | 1 | 0.3 | AssertionError: Failed example: |
| test_getopt | passed | 10 | 10 | 0 | 0 | 0 | 9 | 9 | 0.4 |  |
| test_getpass | passed | 50 | 50 | 0 | 0 | 0 | 50 | 50 | 0.6 |  |
| test_getpath | passed | 32 | 32 | 0 | 0 | 0 | 32 | 32 | 0.5 |  |
| test_gettext | passed | 74 | 73 | 0 | 0 | 1 | 74 | 73 | 0.5 |  |
| test_glob | passed | 22 | 20 | 0 | 0 | 2 | 20 | 20 | 1.1 |  |
| test_global | passed | 20 | 20 | 0 | 0 | 0 | 20 | 20 | 0.3 |  |
| test_grammar | passed | 75 | 75 | 0 | 0 | 0 | 75 | 75 | 0.4 |  |
| test_graphlib | passed | 17 | 17 | 0 | 0 | 0 | 17 | 17 | 0.5 |  |
| test_grp | passed | 3 | 3 | 0 | 0 | 0 | 3 | 3 | 0.4 |  |
| test_gzip | passed | 78 | 78 | 0 | 0 | 0 | 78 | 78 | 2.5 |  |
| test_hash | failed | 30 | 11 | 6 | 3 | 10 | 30 | 11 | 1.2 |  |
| test_hashlib | passed | 93 | 78 | 0 | 0 | 15 | 79 | 78 | 3.6 |  |
| test_heapq | passed | 69 | 69 | 0 | 0 | 0 | 69 | 69 | 0.7 |  |
| test_hmac | passed | 147 | 144 | 0 | 0 | 3 | 144 | 144 | 0.7 |  |
| test_html | passed | 2 | 2 | 0 | 0 | 0 | 2 | 2 | 0.3 |  |
| test_htmlparser | passed | 68 | 66 | 0 | 0 | 2 | 66 | 66 | 0.4 |  |
| test_http_cookiejar | passed | 81 | 81 | 0 | 0 | 0 | 81 | 81 | 0.7 |  |
| test_http_cookies | passed | 35 | 34 | 0 | 0 | 1 | 34 | 34 | 0.4 |  |
| test_httplib | passed | 151 | 145 | 0 | 0 | 6 | 146 | 145 | 1.4 |  |
| test_httpservers | passed | 103 | 103 | 0 | 0 | 0 | 103 | 103 | 7.8 |  |
| test_imaplib | passed | 239 | 237 | 0 | 0 | 2 | 239 | 237 | 43.1 |  |
| test_import | failed | 128 | 82 | 0 | 1 | 45 | 125 | 82 | 5.7 |  |
| test_importlib.builtin.test_finder | passed | 4 | 4 | 0 | 0 | 0 | 4 | 4 | 0.4 |  |
| test_importlib.builtin.test_loader | passed | 8 | 8 | 0 | 0 | 0 | 8 | 8 | 0.4 |  |
| test_importlib.extension.test_case_sensitivity | passed | 4 | 0 | 0 | 0 | 4 | 0 | 0 | 0.4 |  |
| test_importlib.extension.test_finder | passed | 6 | 0 | 0 | 0 | 6 | 6 | 0 | 0.4 |  |
| test_importlib.extension.test_loader | passed | 24 | 0 | 0 | 0 | 24 | 25 | 0 | 0.3 |  |
| test_importlib.extension.test_path_hook | passed | 2 | 0 | 0 | 0 | 2 | 2 | 0 | 0.3 |  |
| test_importlib.frozen.test_finder | passed | 12 | 12 | 0 | 0 | 0 | 12 | 12 | 0.4 |  |
| test_importlib.frozen.test_loader | passed | 18 | 18 | 0 | 0 | 0 | 18 | 18 | 0.3 |  |
| test_importlib.import_.test___loader__ | passed | 2 | 2 | 0 | 0 | 0 | 2 | 2 | 0.3 |  |
| test_importlib.import_.test___package__ | passed | 19 | 19 | 0 | 0 | 0 | 19 | 19 | 0.3 |  |
| test_importlib.import_.test_api | passed | 12 | 12 | 0 | 0 | 0 | 12 | 12 | 0.4 |  |
| test_importlib.import_.test_caching | passed | 9 | 9 | 0 | 0 | 0 | 9 | 9 | 0.4 |  |
| test_importlib.import_.test_fromlist | passed | 30 | 30 | 0 | 0 | 0 | 30 | 30 | 0.4 |  |
| test_importlib.import_.test_helpers | passed | 17 | 17 | 0 | 0 | 0 | 17 | 17 | 0.4 |  |
| test_importlib.import_.test_meta_path | passed | 10 | 10 | 0 | 0 | 0 | 10 | 10 | 0.3 |  |
| test_importlib.import_.test_packages | passed | 16 | 16 | 0 | 0 | 0 | 16 | 16 | 0.3 |  |
| test_importlib.import_.test_path | failed | 58 | 46 | 0 | 12 | 0 | 46 | 46 | 0.7 |  |
| test_importlib.import_.test_relative_imports | passed | 30 | 30 | 0 | 0 | 0 | 30 | 30 | 0.3 |  |
| test_importlib.metadata.test_api | passed | 36 | 36 | 0 | 0 | 0 | 36 | 36 | 3.0 |  |
| test_importlib.metadata.test_main | passed | 39 | 38 | 0 | 0 | 1 | 38 | 38 | 1.2 |  |
| test_importlib.metadata.test_zip | passed | 17 | 15 | 0 | 0 | 2 | 17 | 15 | 0.4 |  |
| test_importlib.resources | passed | 214 | 213 | 0 | 0 | 1 | 213 | 213 | 4.0 |  |
| test_importlib.source.test_case_sensitivity | passed | 4 | 0 | 0 | 0 | 4 | 0 | 0 | 0.3 |  |
| test_importlib.source.test_file_loader | failed | 67 | 61 | 0 | 6 | 0 | 61 | 61 | 1.0 |  |
| test_importlib.source.test_finder | passed | 44 | 44 | 0 | 0 | 0 | 44 | 44 | 0.8 |  |
| test_importlib.source.test_path_hook | passed | 4 | 4 | 0 | 0 | 0 | 4 | 4 | 0.3 |  |
| test_importlib.source.test_source_encoding | passed | 20 | 20 | 0 | 0 | 0 | 20 | 20 | 0.6 |  |
| test_importlib.test_abc | passed | 105 | 105 | 0 | 0 | 0 | 105 | 105 | 0.5 |  |
| test_importlib.test_api | passed | 56 | 56 | 0 | 0 | 0 | 56 | 56 | 0.5 |  |
| test_importlib.test_discover | passed | 12 | 12 | 0 | 0 | 0 | 12 | 12 | 0.4 |  |
| test_importlib.test_lazy | passed | 15 | 15 | 0 | 0 | 0 | 15 | 15 | 0.5 |  |
| test_importlib.test_locks | passed | 34 | 34 | 0 | 0 | 0 | 34 | 34 | 1.3 |  |
| test_importlib.test_namespace_pkgs | failed | 31 | 30 | 0 | 1 | 0 | 30 | 30 | 0.4 |  |
| test_importlib.test_pkg_import | passed | 1 | 1 | 0 | 0 | 0 | 1 | 1 | 0.3 |  |
| test_importlib.test_spec | passed | 106 | 106 | 0 | 0 | 0 | 106 | 106 | 0.5 |  |
| test_importlib.test_threaded_import | passed | 26 | 21 | 0 | 0 | 5 | 21 | 21 | 3.5 |  |
| test_importlib.test_util | failed | 122 | 116 | 1 | 0 | 5 | 120 | 116 | 0.6 |  |
| test_importlib.test_windows | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | No module named 'winreg' |
| test_index | passed | 55 | 55 | 0 | 0 | 0 | 55 | 55 | 0.3 |  |
| test_inspect.test_inspect | failed | 382 | 334 | 1 | 1 | 46 | 382 | 334 | 2.5 |  |
| test_int | passed | 52 | 41 | 0 | 0 | 11 | 49 | 41 | 0.6 |  |
| test_int_literal | passed | 6 | 6 | 0 | 0 | 0 | 6 | 6 | 0.4 |  |
| test_interpreters.test_api | skipped | 0 | 0 | 0 | 0 | 0 | 99 | 0 | 0.3 | No module named '_interpreters' |
| test_interpreters.test_channels | skipped | 0 | 0 | 0 | 0 | 0 | 35 | 0 | 0.2 | No module named '_interpchannels' |
| test_interpreters.test_lifecycle | skipped | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0.2 | No module named '_interpreters' |
| test_interpreters.test_queues | skipped | 0 | 0 | 0 | 0 | 0 | 30 | 0 | 0.3 | No module named '_interpqueues' |
| test_interpreters.test_stress | skipped | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0.3 | No module named '_interpreters' |
| test_io.test_bufferedio | failed | 352 | 331 | 0 | 9 | 12 | 346 | 331 | 3.9 |  |
| test_io.test_file | passed | 36 | 34 | 0 | 0 | 2 | 34 | 34 | 0.5 |  |
| test_io.test_fileio | passed | 100 | 99 | 0 | 0 | 1 | 100 | 99 | 1.7 |  |
| test_io.test_general | passed | 145 | 132 | 0 | 0 | 13 | 141 | 132 | 3.1 |  |
| test_io.test_largefile | passed | 16 | 10 | 0 | 0 | 6 | 10 | 10 | 0.4 |  |
| test_io.test_memoryio | passed | 188 | 181 | 0 | 0 | 7 | 188 | 181 | 2.3 |  |
| test_io.test_signals | passed | 16 | 8 | 0 | 0 | 8 | 8 | 8 | 8.7 |  |
| test_io.test_textio | failed | 169 | 163 | 0 | 3 | 3 | 167 | 163 | 5.5 |  |
| test_io.test_univnewlines | passed | 34 | 34 | 0 | 0 | 0 | 34 | 34 | 0.4 |  |
| test_ioctl | passed | 4 | 4 | 0 | 0 | 0 | 4 | 4 | 0.8 |  |
| test_ipaddress | passed | 212 | 212 | 0 | 0 | 0 | 212 | 212 | 0.5 |  |
| test_isinstance | passed | 23 | 23 | 0 | 0 | 0 | 23 | 23 | 0.6 |  |
| test_iter | passed | 57 | 55 | 0 | 0 | 2 | 57 | 55 | 0.4 |  |
| test_iterlen | passed | 22 | 22 | 0 | 0 | 0 | 22 | 22 | 0.3 |  |
| test_itertools | passed | 137 | 115 | 0 | 0 | 22 | 132 | 115 | 2.5 |  |
| test_json.test_decode | passed | 42 | 42 | 0 | 0 | 0 | 42 | 42 | 0.4 |  |
| test_json.test_default | passed | 6 | 6 | 0 | 0 | 0 | 6 | 6 | 0.3 |  |
| test_json.test_dump | passed | 23 | 23 | 0 | 0 | 0 | 23 | 23 | 0.4 |  |
| test_json.test_encode_basestring_ascii | passed | 7 | 6 | 0 | 0 | 1 | 6 | 6 | 0.3 |  |
| test_json.test_enum | passed | 14 | 14 | 0 | 0 | 0 | 14 | 14 | 0.4 |  |
| test_json.test_fail | passed | 14 | 14 | 0 | 0 | 0 | 14 | 14 | 0.3 |  |
| test_json.test_float | passed | 8 | 8 | 0 | 0 | 0 | 8 | 8 | 0.5 |  |
| test_json.test_indent | passed | 4 | 4 | 0 | 0 | 0 | 4 | 4 | 0.4 |  |
| test_json.test_pass1 | passed | 2 | 2 | 0 | 0 | 0 | 2 | 2 | 0.4 |  |
| test_json.test_pass2 | passed | 2 | 2 | 0 | 0 | 0 | 2 | 2 | 0.3 |  |
| test_json.test_pass3 | passed | 2 | 2 | 0 | 0 | 0 | 2 | 2 | 0.3 |  |
| test_json.test_pickleable | passed | 1 | 1 | 0 | 0 | 0 | 1 | 1 | 0.3 |  |
| test_json.test_recursion | passed | 12 | 10 | 0 | 0 | 2 | 10 | 10 | 0.7 |  |
| test_json.test_scanstring | passed | 8 | 8 | 0 | 0 | 0 | 8 | 8 | 0.3 |  |
| test_json.test_separators | passed | 4 | 4 | 0 | 0 | 0 | 4 | 4 | 0.5 |  |
| test_json.test_speedups | passed | 12 | 12 | 0 | 0 | 0 | 12 | 12 | 0.5 |  |
| test_json.test_tool | passed | 34 | 34 | 0 | 0 | 0 | 34 | 34 | 8.3 |  |
| test_json.test_unicode | passed | 34 | 34 | 0 | 0 | 0 | 34 | 34 | 0.8 |  |
| test_keyword | passed | 11 | 11 | 0 | 0 | 0 | 11 | 11 | 0.3 |  |
| test_keywordonlyarg | passed | 11 | 11 | 0 | 0 | 0 | 11 | 11 | 0.4 |  |
| test_kqueue | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | test works only on BSD |
| test_lazy_import | passed | 166 | 162 | 0 | 0 | 4 | 166 | 162 | 12.1 |  |
| test_linecache | passed | 36 | 36 | 0 | 0 | 0 | 36 | 36 | 0.8 |  |
| test_list | failed | 69 | 65 | 2 | 0 | 2 | 69 | 65 | 0.7 |  |
| test_listcomps | passed | 65 | 65 | 0 | 0 | 0 | 65 | 65 | 0.6 |  |
| test_lltrace | passed | 3 | 0 | 0 | 0 | 3 | 0 | 0 | 0.3 |  |
| test_locale | passed | 45 | 40 | 0 | 0 | 5 | 41 | 40 | 0.5 |  |
| test_logging | passed | 289 | 283 | 0 | 0 | 6 | 284 | 283 | 17.7 |  |
| test_long | passed | 48 | 40 | 0 | 0 | 8 | 48 | 40 | 1.6 |  |
| test_longexp | passed | 1 | 1 | 0 | 0 | 0 | 1 | 1 | 0.3 |  |
| test_lzma | failed | 121 | 119 | 1 | 0 | 1 | 120 | 119 | 0.8 |  |
| test_mailbox | passed | 386 | 381 | 0 | 0 | 5 | 383 | 381 | 6.3 |  |
| test_marshal | failed | 82 | 61 | 3 | 2 | 16 | 75 | 61 | 1.6 |  |
| test_math | passed | 89 | 86 | 0 | 0 | 3 | 87 | 86 | 1.2 |  |
| test_math_integer | passed | 19 | 17 | 0 | 0 | 2 | 19 | 17 | 0.9 |  |
| test_math_property | passed | 2 | 0 | 0 | 0 | 2 | 0 | 0 | 0.3 |  |
| test_memoryview | passed | 173 | 154 | 0 | 0 | 19 | 154 | 154 | 1.5 |  |
| test_metaclass | passed | 1 | 1 | 0 | 0 | 0 | 1 | 1 | 0.4 |  |
| test_mimetypes | passed | 46 | 42 | 0 | 0 | 4 | 43 | 42 | 1.7 |  |
| test_minidom | passed | 133 | 132 | 0 | 0 | 1 | 132 | 132 | 0.4 |  |
| test_mmap | failed | 55 | 47 | 0 | 1 | 7 | 48 | 47 | 1.7 |  |
| test_module | passed | 39 | 39 | 0 | 0 | 0 | 39 | 39 | 0.6 |  |
| test_modulefinder | passed | 18 | 18 | 0 | 0 | 0 | 18 | 18 | 4.7 |  |
| test_monitoring | failed | 95 | 73 | 18 | 0 | 4 | 100 | 73 | 0.5 |  |
| test_multibytecodec | passed | 39 | 37 | 0 | 0 | 2 | 38 | 37 | 0.3 |  |
| test_multiprocessing_fork.test_manager | failed | 11 | 0 | 0 | 11 | 0 | 69 | 0 | 0.6 |  |
| test_multiprocessing_fork.test_misc | failed | 91 | 51 | 4 | 16 | 20 | 73 | 51 | 24.1 |  |
| test_multiprocessing_fork.test_processes | failed | 138 | 54 | 1 | 75 | 8 | 155 | 54 | 8.0 |  |
| test_multiprocessing_fork.test_threads | failed | 111 | 77 | 0 | 1 | 33 | 78 | 77 | 14.7 |  |
| test_multiprocessing_forkserver.test_manager | skipped | 0 | 0 | 0 | 0 | 0 | 69 | 0 | 0.3 | requires working os.fork() |
| test_multiprocessing_forkserver.test_misc | skipped | 0 | 0 | 0 | 0 | 0 | 83 | 0 | 0.2 | requires working os.fork() |
| test_multiprocessing_forkserver.test_preload | skipped | 0 | 0 | 0 | 0 | 0 | 14 | 0 | 0.3 | requires working os.fork() |
| test_multiprocessing_forkserver.test_processes | skipped | 0 | 0 | 0 | 0 | 0 | 163 | 0 | 0.3 | requires working os.fork() |
| test_multiprocessing_forkserver.test_threads | skipped | 0 | 0 | 0 | 0 | 0 | 78 | 0 | 0.2 | requires working os.fork() |
| test_multiprocessing_main_handling | passed | 39 | 13 | 0 | 0 | 26 | 39 | 13 | 7.4 |  |
| test_multiprocessing_spawn.test_manager | passed | 82 | 69 | 0 | 0 | 13 | 69 | 69 | 26.7 |  |
| test_multiprocessing_spawn.test_misc | failed | 91 | 65 | 5 | 4 | 17 | 77 | 65 | 32.0 |  |
| test_multiprocessing_spawn.test_processes | failed | 166 | 154 | 3 | 0 | 9 | 157 | 154 | 55.3 |  |
| test_multiprocessing_spawn.test_threads | passed | 111 | 78 | 0 | 0 | 33 | 78 | 78 | 15.6 |  |
| test_named_expressions | passed | 74 | 74 | 0 | 0 | 0 | 74 | 74 | 0.3 |  |
| test_netrc | passed | 25 | 24 | 0 | 0 | 1 | 24 | 24 | 0.6 |  |
| test_ntpath | passed | 110 | 83 | 0 | 0 | 27 | 83 | 83 | 0.6 |  |
| test_nturl2path | passed | 6 | 6 | 0 | 0 | 0 | 6 | 6 | 0.3 |  |
| test_numeric_tower | passed | 9 | 9 | 0 | 0 | 0 | 9 | 9 | 0.5 |  |
| test_opcache | skipped | 0 | 0 | 0 | 0 | 0 | 83 | 0 | 0.3 | implementation detail specific to cpython |
| test_opcodes | passed | 8 | 8 | 0 | 0 | 0 | 8 | 8 | 0.3 |  |
| test_openpty | passed | 1 | 1 | 0 | 0 | 0 | 1 | 1 | 0.3 |  |
| test_operator | passed | 112 | 112 | 0 | 0 | 0 | 112 | 112 | 0.4 |  |
| test_optimizer | skipped | 0 | 0 | 0 | 0 | 0 | 5 | 0 | 0.3 | No module named '_testinternalcapi' |
| test_optparse | passed | 155 | 153 | 0 | 0 | 2 | 154 | 152 | 0.5 |  |
| test_ordered_dict | failed | 299 | 285 | 6 | 0 | 8 | 299 | 285 | 1.3 |  |
| test_os.test_os | failed | 366 | 329 | 1 | 0 | 36 | 334 | 329 | 18.4 |  |
| test_os.test_posix | failed | 186 | 144 | 0 | 2 | 40 | 150 | 144 | 4.0 |  |
| test_os.test_windows | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | Win32 specific tests |
| test_osx_env | passed | 1 | 0 | 0 | 0 | 1 | 0 | 0 | 0.3 |  |
| test_pathlib.test_copy | passed | 52 | 48 | 0 | 0 | 4 | 48 | 48 | 1.0 |  |
| test_pathlib.test_join | passed | 63 | 63 | 0 | 0 | 0 | 63 | 63 | 1.4 |  |
| test_pathlib.test_join_posix | passed | 6 | 6 | 0 | 0 | 0 | 6 | 6 | 0.4 |  |
| test_pathlib.test_join_windows | passed | 30 | 30 | 0 | 0 | 0 | 30 | 30 | 0.3 |  |
| test_pathlib.test_pathlib | failed | 1151 | 756 | 0 | 3 | 392 | 757 | 756 | 19.1 |  |
| test_pathlib.test_read | passed | 63 | 57 | 0 | 0 | 6 | 57 | 57 | 0.7 |  |
| test_pathlib.test_write | passed | 33 | 27 | 0 | 0 | 6 | 27 | 27 | 0.4 |  |
| test_patma | passed | 343 | 343 | 0 | 0 | 0 | 343 | 343 | 0.5 |  |
| test_pdb | failed | 236 | 224 | 0 | 0 | 12 | 233 | 224 | 20.7 | AssertionError: Failed example: |
| test_peepholer | failed | 143 | 20 | 32 | 0 | 91 | 142 | 20 | 0.6 |  |
| test_pep646_syntax | passed | 1 | 1 | 0 | 0 | 0 | 1 | 1 | 0.3 |  |
| test_perf_profiler | skipped | 0 | 0 | 0 | 0 | 0 | 10 | 0 | 0.3 | perf trampoline profiling not supported |
| test_perfmaps | skipped | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0.2 | requires _testinternalcapi |
| test_pickle | passed | 1085 | 1015 | 0 | 0 | 70 | 1033 | 1015 | 8.9 |  |
| test_picklebuffer | passed | 9 | 6 | 0 | 0 | 3 | 9 | 6 | 0.3 |  |
| test_pickletools | passed | 204 | 189 | 0 | 0 | 15 | 189 | 189 | 1.9 |  |
| test_pkg | passed | 8 | 8 | 0 | 0 | 0 | 8 | 8 | 0.5 |  |
| test_pkgutil | passed | 22 | 22 | 0 | 0 | 0 | 22 | 22 | 0.6 |  |
| test_platform | failed | 39 | 33 | 0 | 1 | 5 | 35 | 33 | 0.9 |  |
| test_plistlib | passed | 72 | 70 | 0 | 0 | 2 | 70 | 70 | 2.0 |  |
| test_poll | passed | 7 | 5 | 0 | 0 | 2 | 6 | 5 | 1.4 |  |
| test_popen | passed | 5 | 5 | 0 | 0 | 0 | 5 | 5 | 0.6 |  |
| test_poplib | passed | 74 | 74 | 0 | 0 | 0 | 74 | 74 | 6.3 |  |
| test_positional_only_arg | failed | 28 | 27 | 1 | 0 | 0 | 28 | 27 | 0.3 |  |
| test_posixpath | passed | 96 | 91 | 0 | 0 | 5 | 92 | 91 | 0.8 |  |
| test_pow | passed | 7 | 7 | 0 | 0 | 0 | 7 | 7 | 0.9 |  |
| test_pprint | passed | 77 | 76 | 0 | 0 | 1 | 77 | 76 | 0.5 |  |
| test_print | passed | 9 | 9 | 0 | 0 | 0 | 9 | 9 | 0.5 |  |
| test_profile | passed | 7 | 7 | 0 | 0 | 0 | 7 | 7 | 1.1 |  |
| test_profiling.test_heatmap | passed | 50 | 50 | 0 | 0 | 0 | 50 | 50 | 0.6 |  |
| test_profiling.test_sampling_profiler.test_advanced | passed | 5 | 0 | 0 | 0 | 5 | 5 | 0 | 0.4 |  |
| test_profiling.test_sampling_profiler.test_async | passed | 22 | 22 | 0 | 0 | 0 | 22 | 22 | 0.3 |  |
| test_profiling.test_sampling_profiler.test_binary_format | failed | 84 | 0 | 0 | 79 | 5 | 84 | 0 | 0.9 |  |
| test_profiling.test_sampling_profiler.test_blocking | passed | 3 | 0 | 0 | 0 | 3 | 1 | 0 | 0.4 |  |
| test_profiling.test_sampling_profiler.test_children | passed | 32 | 1 | 0 | 0 | 31 | 32 | 1 | 0.9 |  |
| test_profiling.test_sampling_profiler.test_cli | failed | 55 | 50 | 0 | 1 | 4 | 55 | 50 | 0.9 |  |
| test_profiling.test_sampling_profiler.test_collectors | failed | 114 | 111 | 0 | 3 | 0 | 114 | 111 | 1.6 |  |
| test_profiling.test_sampling_profiler.test_dump | passed | 17 | 17 | 0 | 0 | 0 | 17 | 17 | 0.4 |  |
| test_profiling.test_sampling_profiler.test_integration | passed | 21 | 0 | 0 | 0 | 21 | 21 | 0 | 0.4 |  |
| test_profiling.test_sampling_profiler.test_live_collector_core | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | Use of the 'curses' resource not enabled |
| test_profiling.test_sampling_profiler.test_live_collector_interaction | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.2 | Use of the 'curses' resource not enabled |
| test_profiling.test_sampling_profiler.test_live_collector_ui | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | Use of the 'curses' resource not enabled |
| test_profiling.test_sampling_profiler.test_modes | passed | 15 | 0 | 0 | 0 | 15 | 15 | 0 | 0.3 |  |
| test_profiling.test_sampling_profiler.test_profiler | passed | 29 | 29 | 0 | 0 | 0 | 29 | 29 | 0.4 |  |
| test_profiling.test_sampling_profiler.test_sync_coordinator | passed | 2 | 2 | 0 | 0 | 0 | 2 | 2 | 0.6 |  |
| test_profiling.test_sampling_profiler.test_trend_tracker | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.2 | Use of the 'curses' resource not enabled |
| test_profiling.test_tracing_profiler | passed | 30 | 29 | 0 | 0 | 1 | 30 | 29 | 2.0 |  |
| test_property | passed | 31 | 29 | 0 | 0 | 2 | 29 | 29 | 0.3 |  |
| test_pstats | passed | 13 | 12 | 0 | 0 | 1 | 13 | 12 | 0.7 |  |
| test_pty | failed | 6 | 4 | 0 | 2 | 0 | 6 | 4 | 0.3 |  |
| test_pulldom | passed | 11 | 11 | 0 | 0 | 0 | 11 | 11 | 0.4 |  |
| test_pwd | passed | 3 | 3 | 0 | 0 | 0 | 3 | 3 | 0.3 |  |
| test_py_compile | passed | 34 | 34 | 0 | 0 | 0 | 34 | 34 | 1.3 |  |
| test_pyclbr | passed | 6 | 6 | 0 | 0 | 0 | 6 | 6 | 1.1 |  |
| test_pydoc.test_pydoc | failed | 119 | 112 | 1 | 0 | 6 | 119 | 112 | 3.4 |  |
| test_pyexpat | passed | 89 | 85 | 0 | 0 | 4 | 89 | 85 | 0.7 |  |
| test_pyrepl.test_eventqueue | passed | 26 | 13 | 0 | 0 | 13 | 13 | 13 | 0.4 |  |
| test_pyrepl.test_fancycompleter | passed | 21 | 21 | 0 | 0 | 0 | 21 | 21 | 0.4 |  |
| test_pyrepl.test_input | passed | 10 | 10 | 0 | 0 | 0 | 10 | 10 | 0.3 |  |
| test_pyrepl.test_interact | passed | 29 | 29 | 0 | 0 | 0 | 29 | 29 | 0.5 |  |
| test_pyrepl.test_keymap | passed | 17 | 17 | 0 | 0 | 0 | 17 | 17 | 0.4 |  |
| test_pyrepl.test_layout | passed | 36 | 36 | 0 | 0 | 0 | 36 | 36 | 0.3 |  |
| test_pyrepl.test_pyrepl | passed | 134 | 86 | 0 | 0 | 48 | 86 | 86 | 2.5 |  |
| test_pyrepl.test_reader | passed | 33 | 33 | 0 | 0 | 0 | 33 | 33 | 1.5 |  |
| test_pyrepl.test_render | passed | 31 | 31 | 0 | 0 | 0 | 31 | 31 | 0.3 |  |
| test_pyrepl.test_terminfo | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.2 | Use of the 'curses' resource not enabled |
| test_pyrepl.test_unix_console | passed | 21 | 20 | 0 | 0 | 1 | 20 | 20 | 0.7 |  |
| test_pyrepl.test_utils | passed | 4 | 4 | 0 | 0 | 0 | 4 | 4 | 0.3 |  |
| test_pyrepl.test_windows_console | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.2 | test only relevant on win32 |
| test_pystats | passed | 5 | 0 | 0 | 0 | 5 | 0 | 0 | 0.3 |  |
| test_queue | passed | 165 | 158 | 0 | 0 | 7 | 159 | 158 | 11.4 |  |
| test_quopri | passed | 11 | 11 | 0 | 0 | 0 | 11 | 11 | 0.5 |  |
| test_raise | passed | 37 | 37 | 0 | 0 | 0 | 37 | 37 | 0.3 |  |
| test_random | failed | 116 | 110 | 0 | 1 | 5 | 114 | 110 | 1.0 |  |
| test_range | passed | 29 | 29 | 0 | 0 | 0 | 29 | 29 | 1.1 |  |
| test_re | passed | 168 | 154 | 0 | 0 | 14 | 164 | 154 | 1.2 |  |
| test_readline | skipped | 0 | 0 | 0 | 0 | 0 | 16 | 0 | 0.3 | No module named 'readline' |
| test_regrtest | failed | 124 | 114 | 1 | 0 | 9 | 117 | 114 | 35.6 |  |
| test_remote_pdb | skipped | 0 | 0 | 0 | 0 | 0 | 48 | 0 | 0.3 | remote debugging is disabled |
| test_repl | failed | 18 | 12 | 3 | 0 | 3 | 18 | 12 | 4.0 |  |
| test_reprlib | passed | 33 | 31 | 0 | 0 | 2 | 31 | 31 | 0.5 |  |
| test_resource | passed | 14 | 14 | 0 | 0 | 0 | 14 | 14 | 0.4 |  |
| test_richcmp | passed | 11 | 11 | 0 | 0 | 0 | 11 | 11 | 0.3 |  |
| test_rlcompleter | passed | 11 | 11 | 0 | 0 | 0 | 11 | 11 | 0.7 |  |
| test_robotparser | passed | 107 | 107 | 0 | 0 | 0 | 107 | 107 | 0.4 |  |
| test_runpy | passed | 42 | 41 | 0 | 0 | 1 | 41 | 41 | 2.3 |  |
| test_samply_profiler | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.2 | perf trampoline profiling not supported |
| test_sax | passed | 192 | 192 | 0 | 0 | 0 | 192 | 192 | 0.6 |  |
| test_sched | passed | 11 | 11 | 0 | 0 | 0 | 11 | 11 | 0.9 |  |
| test_scope | passed | 41 | 38 | 0 | 0 | 3 | 41 | 38 | 0.3 |  |
| test_script_helper | passed | 10 | 10 | 0 | 0 | 0 | 10 | 10 | 0.8 |  |
| test_secrets | passed | 11 | 11 | 0 | 0 | 0 | 11 | 11 | 0.3 |  |
| test_select | passed | 6 | 5 | 0 | 0 | 1 | 6 | 5 | 1.3 |  |
| test_selectors | passed | 121 | 77 | 0 | 0 | 44 | 77 | 77 | 14.4 |  |
| test_set | passed | 644 | 644 | 0 | 0 | 0 | 644 | 644 | 3.2 |  |
| test_setcomps | passed | 2 | 2 | 0 | 0 | 0 | 2 | 2 | 0.4 |  |
| test_shelve | passed | 274 | 271 | 0 | 0 | 3 | 439 | 271 | 12.5 |  |
| test_shlex | passed | 45 | 44 | 0 | 0 | 1 | 45 | 44 | 0.4 |  |
| test_shutil | passed | 227 | 178 | 0 | 0 | 49 | 178 | 178 | 5.7 |  |
| test_signal | passed | 57 | 44 | 0 | 0 | 13 | 52 | 44 | 14.9 |  |
| test_site | passed | 97 | 90 | 0 | 0 | 7 | 91 | 90 | 3.0 |  |
| test_slice | passed | 11 | 11 | 0 | 0 | 0 | 11 | 11 | 0.5 |  |
| test_smtplib | passed | 85 | 85 | 0 | 0 | 0 | 85 | 85 | 2.0 |  |
| test_smtpnet | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | Use of the 'network' resource not enabled |
| test_socket | failed | 751 | 615 | 1 | 0 | 135 | 622 | 615 | 42.5 |  |
| test_socketserver | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | Use of the 'network' resource not enabled |
| test_sort | failed | 21 | 20 | 1 | 0 | 0 | 21 | 20 | 0.4 |  |
| test_source_encoding | passed | 94 | 93 | 0 | 0 | 1 | 93 | 93 | 4.5 |  |
| test_sqlite3.test_backup | passed | 15 | 15 | 0 | 0 | 0 | 15 | 15 | 0.2 |  |
| test_sqlite3.test_cli | passed | 19 | 19 | 0 | 0 | 0 | 26 | 19 | 0.4 |  |
| test_sqlite3.test_dbapi | passed | 206 | 204 | 0 | 0 | 2 | 206 | 204 | 0.8 |  |
| test_sqlite3.test_dump | passed | 8 | 8 | 0 | 0 | 0 | 8 | 8 | 0.3 |  |
| test_sqlite3.test_factory | passed | 28 | 28 | 0 | 0 | 0 | 28 | 28 | 0.3 |  |
| test_sqlite3.test_hooks | passed | 32 | 31 | 0 | 0 | 1 | 32 | 31 | 0.4 |  |
| test_sqlite3.test_regression | passed | 38 | 38 | 0 | 0 | 0 | 38 | 38 | 0.5 |  |
| test_sqlite3.test_transactions | passed | 48 | 48 | 0 | 0 | 0 | 48 | 48 | 1.0 |  |
| test_sqlite3.test_types | passed | 48 | 46 | 0 | 0 | 2 | 46 | 46 | 0.3 |  |
| test_sqlite3.test_userfunctions | failed | 74 | 71 | 1 | 0 | 2 | 72 | 71 | 0.5 |  |
| test_ssl | failed | 222 | 175 | 2 | 3 | 42 | 202 | 175 | 36.8 |  |
| test_stable_abi_ctypes | skipped | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0.4 | requires _testcapi |
| test_startfile | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | object <module 'os' (frozen)> has no attribute 'startfile' |
| test_stat | passed | 22 | 18 | 0 | 0 | 4 | 18 | 18 | 0.3 |  |
| test_statistics | passed | 400 | 394 | 0 | 0 | 6 | 395 | 394 | 1.5 |  |
| test_str | passed | 139 | 128 | 0 | 0 | 11 | 133 | 128 | 3.1 |  |
| test_strftime | passed | 4 | 4 | 0 | 0 | 0 | 4 | 4 | 0.6 |  |
| test_string.test_string | passed | 42 | 41 | 0 | 0 | 1 | 42 | 41 | 0.5 |  |
| test_string.test_templatelib | passed | 13 | 13 | 0 | 0 | 0 | 13 | 13 | 0.4 |  |
| test_string_literals | passed | 20 | 20 | 0 | 0 | 0 | 20 | 20 | 0.6 |  |
| test_stringprep | passed | 1 | 1 | 0 | 0 | 0 | 1 | 1 | 0.5 |  |
| test_strptime | passed | 60 | 49 | 0 | 0 | 11 | 49 | 49 | 0.6 |  |
| test_strtod | passed | 9 | 8 | 0 | 0 | 1 | 8 | 8 | 0.8 |  |
| test_struct | passed | 47 | 41 | 0 | 0 | 6 | 47 | 41 | 1.1 |  |
| test_structseq | passed | 25 | 25 | 0 | 0 | 0 | 25 | 25 | 0.8 |  |
| test_subclassinit | passed | 17 | 17 | 0 | 0 | 0 | 17 | 17 | 0.4 |  |
| test_subprocess | failed | 366 | 301 | 11 | 7 | 47 | 323 | 301 | 42.9 |  |
| test_sundry | passed | 1 | 1 | 0 | 0 | 0 | 1 | 1 | 0.4 |  |
| test_super | passed | 40 | 37 | 0 | 0 | 3 | 40 | 37 | 0.5 |  |
| test_support | passed | 77 | 69 | 0 | 0 | 8 | 72 | 69 | 6.8 |  |
| test_symtable | passed | 42 | 42 | 0 | 0 | 0 | 42 | 42 | 0.4 |  |
| test_syntax | passed | 109 | 93 | 0 | 0 | 16 | 109 | 93 | 0.8 |  |
| test_sys | failed | 105 | 52 | 2 | 0 | 51 | 97 | 52 | 6.5 |  |
| test_sys_setprofile | failed | 29 | 27 | 2 | 0 | 0 | 29 | 27 | 0.4 |  |
| test_sys_settrace | failed | 448 | 365 | 6 | 0 | 77 | 447 | 365 | 1.0 |  |
| test_sysconfig | failed | 43 | 28 | 4 | 3 | 8 | 40 | 28 | 1.3 |  |
| test_syslog | failed | 12 | 8 | 0 | 1 | 3 | 12 | 8 | 0.8 |  |
| test_tabnanny | passed | 21 | 21 | 0 | 0 | 0 | 21 | 21 | 1.1 |  |
| test_tarfile | passed | 781 | 774 | 0 | 0 | 7 | 777 | 774 | 47.4 |  |
| test_tempfile | failed | 121 | 110 | 0 | 1 | 10 | 115 | 110 | 4.0 |  |
| test_termios | passed | 21 | 21 | 0 | 0 | 0 | 21 | 21 | 0.9 |  |
| test_textwrap | passed | 68 | 68 | 0 | 0 | 0 | 68 | 68 | 0.4 |  |
| test_thread | passed | 36 | 34 | 0 | 0 | 2 | 36 | 34 | 2.7 |  |
| test_thread_local_bytecode | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | No module named '_testinternalcapi' |
| test_threadedtempfile | passed | 1 | 0 | 0 | 0 | 1 | 0 | 0 | 0.4 |  |
| test_threading | failed | 247 | 215 | 2 | 0 | 30 | 243 | 215 | 23.1 |  |
| test_threading_local | passed | 22 | 18 | 0 | 0 | 4 | 22 | 18 | 2.5 |  |
| test_threadsignals | passed | 6 | 6 | 0 | 0 | 0 | 6 | 6 | 5.3 |  |
| test_time | failed | 65 | 48 | 1 | 0 | 16 | 62 | 48 | 3.5 |  |
| test_timeit | passed | 44 | 44 | 0 | 0 | 0 | 44 | 44 | 0.5 |  |
| test_timeout | passed | 1 | 0 | 0 | 0 | 1 | 0 | 0 | 0.4 |  |
| test_tokenize | failed | 132 | 131 | 0 | 1 | 0 | 132 | 131 | 1.5 |  |
| test_tomllib.test_data | failed | 2 | 2 | 0 | 0 | 0 | 2 | 2 | 0.3 | OSError: [Errno 28] No space left on device |
| test_tomllib.test_error | passed | 8 | 8 | 0 | 0 | 0 | 8 | 8 | 0.3 |  |
| test_tomllib.test_misc | passed | 9 | 9 | 0 | 0 | 0 | 9 | 9 | 1.1 |  |
| test_trace | failed | 27 | 24 | 2 | 0 | 1 | 26 | 24 | 7.5 |  |
| test_traceback | passed | 441 | 244 | 0 | 0 | 197 | 440 | 244 | 10.0 |  |
| test_tracemalloc | failed | 51 | 30 | 7 | 3 | 11 | 51 | 30 | 1.6 |  |
| test_tstring | passed | 17 | 16 | 0 | 0 | 1 | 16 | 16 | 0.7 |  |
| test_tty | passed | 4 | 4 | 0 | 0 | 0 | 4 | 4 | 0.3 |  |
| test_tuple | passed | 39 | 35 | 0 | 0 | 4 | 39 | 35 | 0.5 |  |
| test_type_aliases | passed | 34 | 34 | 0 | 0 | 0 | 34 | 34 | 0.3 |  |
| test_type_annotations | passed | 49 | 48 | 0 | 0 | 1 | 49 | 48 | 0.4 |  |
| test_type_cache | skipped | 0 | 0 | 0 | 0 | 0 | 12 | 0 | 0.3 | No module named '_testcapi' |
| test_type_comments | passed | 18 | 17 | 0 | 0 | 1 | 18 | 17 | 0.3 |  |
| test_type_params | passed | 109 | 109 | 0 | 0 | 0 | 109 | 109 | 0.4 |  |
| test_typechecks | passed | 6 | 6 | 0 | 0 | 0 | 6 | 6 | 0.7 |  |
| test_types | failed | 135 | 133 | 0 | 1 | 1 | 135 | 133 | 0.8 |  |
| test_typing | failed | 742 | 738 | 1 | 0 | 3 | 742 | 738 | 0.9 |  |
| test_ucn | passed | 18 | 16 | 0 | 0 | 2 | 16 | 16 | 1.2 |  |
| test_unary | passed | 6 | 6 | 0 | 0 | 0 | 6 | 6 | 0.3 |  |
| test_unicode_file | passed | 2 | 2 | 0 | 0 | 0 | 2 | 2 | 0.4 |  |
| test_unicode_file_functions | passed | 30 | 30 | 0 | 0 | 0 | 30 | 30 | 0.9 |  |
| test_unicode_identifiers | passed | 3 | 3 | 0 | 0 | 0 | 3 | 3 | 0.2 |  |
| test_unicodedata | passed | 73 | 65 | 0 | 0 | 8 | 66 | 65 | 2.9 |  |
| test_unittest.test_assertions | passed | 35 | 35 | 0 | 0 | 0 | 35 | 35 | 0.5 |  |
| test_unittest.test_async_case | passed | 14 | 14 | 0 | 0 | 0 | 14 | 14 | 1.0 |  |
| test_unittest.test_break | passed | 48 | 46 | 0 | 0 | 2 | 46 | 46 | 0.4 |  |
| test_unittest.test_case | passed | 116 | 115 | 0 | 0 | 1 | 116 | 115 | 0.9 |  |
| test_unittest.test_discovery | passed | 26 | 26 | 0 | 0 | 0 | 26 | 26 | 0.6 |  |
| test_unittest.test_functiontestcase | passed | 8 | 8 | 0 | 0 | 0 | 8 | 8 | 0.3 |  |
| test_unittest.test_loader | passed | 84 | 84 | 0 | 0 | 0 | 84 | 84 | 0.5 |  |
| test_unittest.test_program | passed | 25 | 25 | 0 | 0 | 0 | 25 | 25 | 1.6 |  |
| test_unittest.test_result | passed | 57 | 57 | 0 | 0 | 0 | 57 | 57 | 0.4 |  |
| test_unittest.test_runner | passed | 52 | 52 | 0 | 0 | 0 | 52 | 52 | 1.1 |  |
| test_unittest.test_setups | passed | 17 | 17 | 0 | 0 | 0 | 17 | 17 | 0.4 |  |
| test_unittest.test_skipping | passed | 25 | 25 | 0 | 0 | 0 | 25 | 25 | 0.3 |  |
| test_unittest.test_suite | passed | 28 | 28 | 0 | 0 | 0 | 28 | 28 | 0.3 |  |
| test_unittest.test_util | passed | 6 | 6 | 0 | 0 | 0 | 6 | 6 | 0.3 |  |
| test_unpack | passed | 2 | 2 | 0 | 0 | 0 | 2 | 2 | 0.3 |  |
| test_unpack_ex | passed | 6 | 6 | 0 | 0 | 0 | 6 | 6 | 0.4 |  |
| test_unparse | passed | 81 | 81 | 0 | 0 | 0 | 81 | 81 | 1.9 |  |
| test_urllib | passed | 106 | 104 | 0 | 0 | 2 | 104 | 104 | 0.8 |  |
| test_urllib2 | passed | 85 | 82 | 0 | 0 | 3 | 82 | 82 | 1.1 |  |
| test_urllib2_localnet | passed | 21 | 21 | 0 | 0 | 0 | 21 | 21 | 2.0 |  |
| test_urllib2net | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.4 | Use of the 'network' resource not enabled |
| test_urllib_response | passed | 4 | 4 | 0 | 0 | 0 | 4 | 4 | 0.3 |  |
| test_urllibnet | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.4 | Use of the 'network' resource not enabled |
| test_urlparse | passed | 81 | 78 | 0 | 0 | 3 | 78 | 78 | 0.8 |  |
| test_userdict | passed | 28 | 28 | 0 | 0 | 0 | 28 | 28 | 0.5 |  |
| test_userlist | passed | 54 | 54 | 0 | 0 | 0 | 54 | 54 | 0.6 |  |
| test_userstring | passed | 71 | 69 | 0 | 0 | 2 | 70 | 69 | 2.6 |  |
| test_utf8_mode | failed | 12 | 10 | 1 | 0 | 1 | 11 | 10 | 2.5 |  |
| test_utf8source | passed | 3 | 3 | 0 | 0 | 0 | 3 | 3 | 0.3 |  |
| test_uuid | passed | 120 | 48 | 0 | 0 | 72 | 103 | 48 | 0.5 |  |
| test_venv | failed | 42 | 32 | 1 | 0 | 9 | 33 | 32 | 16.6 |  |
| test_wait3 | skipped | 0 | 0 | 0 | 0 | 0 | 3 | 0 | 0.3 | requires working os.fork() |
| test_wait4 | skipped | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0.3 | requires working os.fork() |
| test_warnings | failed | 205 | 192 | 1 | 0 | 12 | 199 | 192 | 2.8 |  |
| test_wave | passed | 146 | 133 | 0 | 0 | 13 | 133 | 133 | 0.6 |  |
| test_weakref | failed | 140 | 127 | 2 | 0 | 11 | 136 | 127 | 4.3 |  |
| test_weakset | passed | 46 | 46 | 0 | 0 | 0 | 46 | 46 | 0.6 |  |
| test_webbrowser | passed | 64 | 45 | 0 | 0 | 19 | 45 | 45 | 0.4 |  |
| test_with | passed | 55 | 54 | 0 | 0 | 1 | 55 | 54 | 0.3 |  |
| test_wsgiref | passed | 46 | 46 | 0 | 0 | 0 | 46 | 46 | 0.6 |  |
| test_xml | failed | 2 | 1 | 1 | 0 | 0 | 2 | 1 | 0.3 |  |
| test_xml_dom_minicompat | passed | 11 | 11 | 0 | 0 | 0 | 11 | 11 | 0.3 |  |
| test_xml_dom_xmlbuilder | passed | 4 | 4 | 0 | 0 | 0 | 4 | 4 | 0.3 |  |
| test_xml_etree | failed | 238 | 232 | 3 | 0 | 3 | 235 | 232 | 4.6 |  |
| test_xml_etree_c | failed | 256 | 232 | 3 | 0 | 21 | 252 | 230 | 4.4 |  |
| test_xmlrpc | passed | 94 | 85 | 0 | 0 | 9 | 85 | 85 | 0.8 |  |
| test_xpickle | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.4 | Use of the 'xpickle' resource not enabled |
| test_xxlimited | skipped | 0 | 0 | 0 | 0 | 0 | 12 | 0 | 0.2 | No module named 'xxlimited' |
| test_xxtestfuzz | skipped | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0.3 | No module named '_xxtestfuzz' |
| test_yield_from | passed | 43 | 43 | 0 | 0 | 0 | 43 | 43 | 0.4 |  |
| test_zipapp | passed | 36 | 36 | 0 | 0 | 0 | 36 | 36 | 0.7 |  |
| test_zipfile._path.test_complexity | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | Unable to import big_o |
| test_zipfile._path.test_path | passed | 56 | 55 | 0 | 0 | 1 | 55 | 55 | 0.7 |  |
| test_zipfile.test_core | passed | 331 | 329 | 0 | 0 | 2 | 330 | 329 | 18.3 |  |
| test_zipfile64 | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.2 | test requires loads of disk-space bytes and a long time to run |
| test_zipimport | passed | 152 | 140 | 0 | 0 | 12 | 143 | 140 | 0.7 |  |
| test_zipimport_support | passed | 5 | 5 | 0 | 0 | 0 | 5 | 5 | 2.0 |  |
| test_zlib | failed | 88 | 83 | 1 | 0 | 4 | 86 | 83 | 0.8 |  |
| test_zoneinfo.test_zoneinfo | failed | 256 | 219 | 4 | 1 | 32 | 226 | 219 | 1.4 |  |
| test_zoneinfo.test_zoneinfo_property | passed | 23 | 23 | 0 | 0 | 0 | 23 | 23 | 0.5 |  |
| test_zstd | passed | 121 | 121 | 0 | 0 | 0 | 121 | 121 | 2.5 |  |

## Not run

| package | why |
|---|---|
| test_android | Android |
| test_apple | iOS |
| test_capi | the C API |
| test_cext | builds an extension module |
| test_clinic | Argument Clinic |
| test_embed | embeds CPython (needs Programs/_testembed) |
| test_gdb | debugs CPython with gdb |
| test_generated_cases | CPython's interpreter generator |
| test_idle | Tk |
| test_launcher | Windows |
| test_msvcrt | Windows |
| test_peg_generator | builds CPython's parser generator |
| test_tcl | Tk |
| test_tkinter | Tk |
| test_tools | tools of the CPython repository |
| test_ttk | Tk |
| test_ttk_textonly | Tk |
| test_turtle | Tk |
| test_winapi | Windows |
| test_winconsoleio | Windows |
| test_winreg | Windows |
| test_winsound | Windows |
| test_wmi | Windows |
