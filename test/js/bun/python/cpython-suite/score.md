# CPython's test suite under Bun

Run of 2026-11-03 11:48 with `python3`, 4 at a time, 300 s a module; took 59 s.

## Totals

| modules | crashed | failed | no result | passed | skipped | timeout |
|---|---|---|---|---|---|---|
| 676 | 4 | 155 | 30 | 310 | 167 | 10 |

| tests run | passed | failed | errors | skipped |
|---|---|---|---|---|
| 41280 | 34390 | 1102 | 873 | 4915 |

CPython itself, on this machine, in the same harness, passes 44629 tests in these modules: **77.1%** of them pass here.

## Tests that kill the interpreter (23, in 4 modules)

| module | test | what |
|---|---|---|
| test_descr | MroTest.test_incomplete_super | SIGSEGV; segv: Segmentation fault at address 0x18 |
| test_lazy_import | LazyImportTypeTests.test_deeply_dotted_name | SIGSEGV;  |
| test_set | TestBinaryOpsMutating_Set_Set.test_ior_with_mutation | SIGSEGV; segv: Segmentation fault at address 0x8 |
| test_set | TestBinaryOpsMutating_Set_Set.test_ixor_with_mutation | SIGSEGV; segv: Segmentation fault at address 0x8 |
| test_set | TestBinaryOpsMutating_Set_Subclass.test_ior_with_mutation | SIGSEGV; segv: Segmentation fault at address 0x8 |
| test_set | TestBinaryOpsMutating_Set_Subclass.test_ixor_with_mutation | SIGSEGV; segv: Segmentation fault at address 0x8 |
| test_set | TestBinaryOpsMutating_Subclass_Set.test_ior_with_mutation | SIGSEGV; segv: Segmentation fault at address 0x8 |
| test_set | TestBinaryOpsMutating_Subclass_Set.test_ixor_with_mutation | SIGSEGV; segv: Segmentation fault at address 0x8 |
| test_set | TestBinaryOpsMutating_Subclass_Subclass.test_ior_with_mutation | SIGSEGV; segv: Segmentation fault at address 0x8 |
| test_set | TestBinaryOpsMutating_Subclass_Subclass.test_ixor_with_mutation | SIGSEGV; segv: Segmentation fault at address 0x8 |
| test_set | TestMethodsMutating_Set_Dict.test_symmetric_difference_update_with_mutation | SIGSEGV; segv: Segmentation fault at address 0x8 |
| test_set | TestMethodsMutating_Set_Dict.test_update_with_mutation | SIGSEGV; segv: Segmentation fault at address 0x8 |
| test_set | TestMethodsMutating_Set_List.test_symmetric_difference_update_with_mutation | SIGSEGV; segv: Segmentation fault at address 0x8 |
| test_set | TestMethodsMutating_Set_List.test_update_with_mutation | SIGSEGV; segv: Segmentation fault at address 0x8 |
| test_set | TestMethodsMutating_Set_Set.test_symmetric_difference_update_with_mutation | SIGSEGV; segv: Segmentation fault at address 0x8 |
| test_set | TestMethodsMutating_Set_Set.test_update_with_mutation | SIGSEGV; segv: Segmentation fault at address 0x8 |
| test_set | TestMethodsMutating_Set_Subclass.test_symmetric_difference_update_with_mutation | SIGSEGV; segv: Segmentation fault at address 0x8 |
| test_set | TestMethodsMutating_Set_Subclass.test_update_with_mutation | SIGSEGV; segv: Segmentation fault at address 0x8 |
| test_set | TestMethodsMutating_Subclass_Set.test_symmetric_difference_update_with_mutation | SIGSEGV; segv: Segmentation fault at address 0x8 |
| test_set | TestMethodsMutating_Subclass_Set.test_update_with_mutation | SIGSEGV; segv: Segmentation fault at address 0x8 |
| test_set | TestMethodsMutating_Subclass_Subclass.test_symmetric_difference_update_with_mutation | SIGSEGV; segv: Segmentation fault at address 0x8 |
| test_set | TestMethodsMutating_Subclass_Subclass.test_update_with_mutation | SIGSEGV; segv: Segmentation fault at address 0x8 |
| test_type_annotations | RegressionTests.test_conditional_annotations_rebound | SIGSEGV; segv: Segmentation fault at address 0x0 |

## Tests that hang (24, in 11 modules)

| module | test | what |
|---|---|---|
| test_asyncio.test_tasks | PyTask_PyFuture_SubclassTests.test_task_not_crash_without_finalization | no output for 75 s |
| test_asyncio.test_tasks | PyTask_PyFuture_Tests.test_error_in_call_soon | no output for 75 s |
| test_descr | ClassPropertiesAndMethods.test_recursive_call | no output for 75 s |
| test_exceptions | ExceptionTests.test_no_hang_on_context_chain_cycle1 | no output for 75 s |
| test_exceptions | ExceptionTests.test_no_hang_on_context_chain_cycle2 | no output for 75 s |
| test_exceptions | ExceptionTests.test_no_hang_on_context_chain_cycle3 | no output for 75 s |
| test_gc | GCTests.test_trashcan_threads | no output for 75 s |
| test_httpservers | RequestHandlerColorizedLoggingTestCase.test_get | no output for 75 s |
| test_httpservers | RequestHandlerLoggingTestCase.test_get | no output for 75 s |
| test_io.test_signals | CSignalsTest.test_interrupted_write_buffered | no output for 75 s |
| test_io.test_signals | CSignalsTest.test_interrupted_write_text | no output for 75 s |
| test_logging | RotatingFileHandlerTest.test_should_not_rollover_named_pipe | no output for 75 s |
| test_pdb | PdbTestCase.test_async_break | no output for 75 s |
| test_pdb | PdbTestCase.test_blocks_at_first_code_line | no output for 75 s |
| test_pdb | PdbTestCase.test_breakpoint | no output for 75 s |
| test_pdb | PdbTestCase.test_empty_file | no output for 75 s |
| test_pdb | PdbTestCase.test_end_of_options_separator | no output for 75 s |
| test_pdb | PdbTestCase.test_errors_in_command | no output for 75 s |
| test_pdb | PdbTestCase.test_file_modified_after_execution | no output for 75 s |
| test_pdb | PdbTestCase.test_file_modified_after_execution_with_restart | no output for 75 s |
| test_pdb | PdbTestCase.test_file_modified_and_immediately_restarted | no output for 75 s |
| test_str | StrTest.test_adaptive_find | no output for 75 s |
| test_sys_settrace | JumpTestCase.test_no_jump_infinite_while_loop | no output for 75 s |
| test_userstring | UserStringTest.test_adaptive_find | no output for 75 s |

## Modules that could not be run at all (30), by cause

| cause | modules | which |
|---|---|---|
| missing attribute of module: importlib.abc | 11 | test_importlib.resources.test_compatibilty_files, test_importlib.resources.test_contents, test_importlib.resources.test_custom, test_importlib.resources.test_files, test_importlib.resources.test_functional, test_importlib.resources.test_open, test_importlib.resources.test_path, test_importlib.resources.test_read, test_importlib.resources.test_reader, test_importlib.resources.test_resource, test_importlib.resources.test_util |
| missing attribute of module: concurrent.futures.InterpreterPoolExecutor | 8 | test_concurrent_futures.test_as_completed, test_concurrent_futures.test_deadlock, test_concurrent_futures.test_future, test_concurrent_futures.test_init, test_concurrent_futures.test_process_pool, test_concurrent_futures.test_shutdown, test_concurrent_futures.test_thread_pool, test_concurrent_futures.test_wait |
| missing attribute of module: asyncio.tasks._CTask | 2 | test_asyncio.test_eager_task_factory, test_asyncio.test_futures2 |
| missing module: _testinternalcapi | 2 | test_class, test_with |
| missing module: _remote_debugging | 1 | test_asyncio.test_tools |
| missing module: _interpreters | 1 | test_concurrent_futures.test_interpreter_pool |
| not implemented | 1 | test_dis |
| missing module: _multibytecodec | 1 | test_multibytecodec |
| value differs | 1 | test_stringprep |
| missing module: _datetime | 1 | test_types |
| LookupError | 1 | test_zipfile.test_core |

## Failing tests by cause (1975)

| cause | tests | mostly in | example |
|---|---|---|---|
| value differs | 845 | test_sys_settrace (307), test_monitoring (87), test_bdb (31), test_gc (25) | test.test_annotationlib.TestCallAnnotateFunction.test_user_annotate_string_fakeglobals: AssertionError: AssertionError: {'x': "<class 'int'>"} != {'x' |
| LookupError | 417 | test_codecencodings_jp (133), test_codecencodings_iso2022 (94), test_codecencodings_cn (76), test_codecencodings_kr (57) | test.test_codecencodings_cn.Test_GB18030.test_callback_None_index: LookupError: LookupError: unknown encoding: gb18030 |
| exception not raised | 93 | test_sys_settrace (30), test_ordered_dict (10), test_ast (8), test_builtin (6) | test.test_ast.test_ast.AST_Tests.test_assignment_expression_feature_version: AssertionError: AssertionError: SyntaxError not raised |
| missing attribute of module: os.fork | 86 | test_multiprocessing_fork (81), test_multiprocessing_spawn (3), test_pty (2) | test.test_multiprocessing_fork.test_misc.MiscTestCase.test_forked_thread_not_started: AttributeError: AttributeError: module 'os' has no attribute 'fo |
| NameError | 79 | test_getpath (28), test_annotationlib (27), test_typing (9), test_dataclasses (4) | test.test_annotationlib.TestCallAnnotateFunction.test_full_non_function_annotate: NameError: NameError: name 'unknown' is not defined |
| child process | 63 | test_multiprocessing_main_handling (27), test_multiprocessing_fork (6), test_multiprocessing_spawn (5), test_cmd_line_script (4) | test.test_argparse.TestProgName.test_script_compiled: AssertionError: AssertionError: Process return code is 1 |
| missing attribute of type: code._varname_from_oparg | 58 | test_peepholer (35), test_compile (9), test_inspect (9), test_lazy_import (2) | test.test_compile.TestSpecifics.test_backward_jump_conditional_in_loop_in_try: AttributeError: AttributeError: 'code' object has no attribute '_varnam |
| warnings expected or unexpected | 56 | test_sys_settrace (18), test_warnings (18), test_asyncgen (4), test_asyncio (4) | test.test_asyncgen.AsyncGenTest.test_async_gen_3_arg_deprecation_warning: AssertionError: AssertionError: DeprecationWarning not triggered |
| ChildProcessError | 46 | test_multiprocessing_fork (23), test_multiprocessing_spawn (23) | test.test_multiprocessing_fork.test_misc.TestSyncManagerTypes.test_array: ChildProcessError: ChildProcessError: [Errno 10] No child processes |
| ValueError | 28 | test_compile (15), test_inspect (7), test_operator (3), test_complex (1) | test.test_compile.TestExpressionStackSize.test_and: ValueError: ValueError: expected a positive input |
| weak references, finalizers, reference counts | 26 | test_finalization (5), test_pydoc (5), test_dataclasses (4), test_weakref (4) | test.test_audit.AuditTest.test_gc: AssertionError: AssertionError: Lists differ: [] != ['gc.get_objects', 'gc.get_referrers', 'gc.get_referents'] |
| OSError | 15 | test_build_details (10), test_os (2), test_socket (1), test_sysconfig (1) | test.test_build_details.CPythonBuildDetailsTests.test_base_interpreter: FileNotFoundError: FileNotFoundError: [Errno 2] No such file or directory: '/m |
| RuntimeError | 15 | test_subprocess (7), test_cmd_line (4), test_tracemalloc (2), test_platform (1) | test.test_cmd_line.CmdLineTest.test_no_std_streams: RuntimeError: RuntimeError: preexec_fn not supported |
| TypeError | 14 | test_tracemalloc (2), test_typing (2), test_annotationlib (1), test_ast (1) | test.test_annotationlib.TestGetAnnotations.test_partial_evaluation_error: TypeError: TypeError: type 'range' is not subscriptable |
| missing attribute of type: NoneType.exc_type | 13 | test_io (8), test_profiling (4), test_frame (1) | test.test_frame.TestIncompleteFrameAreInvisible.test_entry_frames_are_invisible_during_teardown: AttributeError: AttributeError: 'NoneType' object has |
| ? | 13 | test_multiprocessing_fork (11), test_pdb (2) | setUpClass (test.test_multiprocessing_fork.test_manager.WithManagerTestBarrier):  |
| not implemented | 11 | test_code (5), test_funcattrs (3), test_marshal (2), test_exceptions (1) | test.test_code.CodeTest.test_code_hash_uses_order: NotImplementedError: NotImplementedError: code.replace() cannot change co_posonlyargcount |
| SyntaxError | 10 | test_ucn (3), test_builtin (2), test_ast (1), test_compile (1) | test.test_ast.test_ast.AST_Tests.test_filter_syntax_warnings_by_module: SyntaxError: File "<Lib>/test/test_import/data/syntax_wa |
| message differs | 10 | test_faulthandler (7), test_gc (1), test_regrtest (1), test_source_encoding (1) | test.test_faulthandler.FaultHandlerTests.test_enable_single_thread: AssertionError: AssertionError: Regex didn't match: '(?m)^Fatal Python error: Segm |
| UnicodeEncodeError | 7 | test_pathlib (7) | test.test_pathlib.test_pathlib.PathSubclassTest.test_is_junction_false: UnicodeEncodeError: Traceback (most recent call last): |
| KeyError | 6 | test_hash (3), test_dbm_sqlite3 (1), test_trace (1), test_weakref (1) | test.test_dbm_sqlite3.Misuse.test_misuse_double_create: KeyError: KeyError: b'key' |
| AttributeError | 6 | test_descr (2), test_property (2), test_iter (1), test_source_encoding (1) | test.test_descr.ClassPropertiesAndMethods.test_set_dict: AttributeError: AttributeError: This object has no __dict__ |
| recursion | 5 | test_code_module (1), test_descr (1), test_dict (1), test_pyrepl (1) | test.test_code_module.TestInteractiveConsole.test_compile_error: AssertionError: AssertionError: Regex didn't match: '^(MemoryError\|RecursionError): ' |
| ConnectionResetError | 5 | test_multiprocessing_spawn (3), test_multiprocessing_fork (2) | test.test_multiprocessing_fork.test_misc.TestStdinBadfiledescriptor.test_pool_in_process: ConnectionResetError: ConnectionResetError: [Errno 104] Conn |
| EOFError | 4 | test_logging (2), test_asyncio (1), test_re (1) | test.test_asyncio.test_events.TestPyGetEventLoop.test_get_event_loop_new_process: EOFError: EOFError: unexpected EOF |
| IndexError | 4 | test_audit (1), test_compile (1), test_monitoring (1), test_trace (1) | test.test_audit.AuditTest.test_socket: IndexError: IndexError: list index out of range |
| threads | 4 | test_faulthandler (2), test_audit (1), test_threading (1) | test.test_audit.AuditTest.test_threading: AssertionError: AssertionError: Lists differ: [] != [('_thread.start_new_thread', '(<test_func[123 chars]()' |
| missing attribute of type: NoneType.key | 4 | test_ordered_dict (4) | test.test_ordered_dict.CPythonOrderedDictSubclassTests.test_issue119004_change_linked_list_by_delete_key: AttributeError: AttributeError: 'NoneType' o |
| missing attribute of module: os.spawnv | 3 | test_os (3) | test.test_os.test_os.PidTests.test_waitpid: AttributeError: AttributeError: module 'os' has no attribute 'spawnv' |
| missing attribute of module: pathlib.types | 3 | test_pathlib (3) | test.test_pathlib.test_pathlib.PathSubclassTest.test_matches_writablepath_docstrings: AttributeError: AttributeError: module 'pathlib' has no attribut |
| ZeroDivisionError | 3 | test_sys_settrace (2), test_yield_from (1) | test.test_sys_settrace.JumpTestCase.test_no_jump_from_exception_event: ZeroDivisionError: ZeroDivisionError: division by zero |
| socket.gaierror | 2 | test_asyncio (1), test_socket (1) | test.test_asyncio.test_base_events.BaseEventLoopWithSelectorTests.test_create_connection_service_name: socket.gaierror: socket.gaierror: [Errno -8] Se |
| dbm.sqlite3.error | 2 | test_dbm (2) | test.test_dbm.TestCase_sqlite3.test_anydbm_reorganize_decreased_size: dbm.sqlite3.error: Traceback (most recent call last): |
| missing module: _testcapi | 2 | test_inspect (1), test_traceback (1) | test.test_inspect.test_inspect.TestModuleCLI.test_get_cli_details_for_extension_module: ModuleNotFoundError: ModuleNotFoundError: No module named '_te |
| missing attribute of type: object.fail | 1 | test_annotationlib (1) | test.test_annotationlib.TestForwardRefClass.test_get_annotations_lazy_import: AttributeError: AttributeError: type object 'object' has no attribute 'f |
| ImportError | 1 | test_builtin (1) | test.test_builtin.BuiltinTest.test_exec_builtins_mapping_import: ImportError: ImportError: __import__ not found |
| OverflowError | 1 | test_builtin (1) | test.test_builtin.BuiltinTest.test_len: OverflowError: OverflowError: cannot fit 'int' into an index-sized integer |
| missing attribute of type: NoneType.err_msg | 1 | test_coroutines (1) | test.test_coroutines.OriginTrackingTest.test_unawaited_warning_when_module_broken: AttributeError: AttributeError: 'NoneType' object has no attribute  |
| missing attribute of type: X.a | 1 | test_descr (1) | test.test_descr.ClassPropertiesAndMethods.test_slots: AssertionError: AttributeError: 'X' object has no attribute 'a' |
| missing attribute of type: staticmethod.__name__ | 1 | test_descr (1) | test.test_descr.ClassPropertiesAndMethods.test_staticmethod_annotations_without_dict_access: AttributeError: AttributeError: 'staticmethod' object has |
| missing attribute of type: TypeError.__notes__ | 1 | test_dict (1) | test.test_dict.DictTest.test_update_type_error: AttributeError: AttributeError: 'TypeError' object has no attribute '__notes__'. Did you mean '.__ne__ |
| missing attribute of type: NoneType.origin | 1 | test_inspect (1) | test.test_inspect.test_inspect.TestModuleCLI.test_get_cli_details_for_frozen_module: AttributeError: AttributeError: 'NoneType' object has no attribut |
| MemoryError | 1 | test_random (1) | test.test_random.MersenneTwister_TestBasicOps.test_getrandbits_2G_bits: MemoryError: MemoryError |
| sqlite3.ProgrammingError | 1 | test_sqlite3 (1) | test.test_sqlite3.test_dbapi.ThreadTests.test_check_connection_thread: sqlite3.ProgrammingError: sqlite3.ProgrammingError: Cannot operate on a closed  |
| missing module: _interpreters | 1 | test_syslog (1) | test.test_syslog.Test.test_subinterpreter_concurrent_syslog: ModuleNotFoundError: ModuleNotFoundError: Standard library module '_interpreters' was not |
| missing attribute of type: str.trim | 1 | test_traceback (1) | test.test_traceback.PurePythonSuggestionFormattingTests.test_cross_language_levenshtein_fallback: AssertionError: AssertionError: 'strip' not found in |
| SystemError | 1 | test_type_annotations (1) | test.test_type_annotations.DeferredEvaluationTests.test_class_annotation_dunder_classdict: SystemError: SystemError: no cell for the free variable '__ |
| missing attribute of module: warnings.defaultaction | 1 | test_warnings (1) | test.test_warnings._WarningsTests.test_default_action: AttributeError: AttributeError: module 'warnings' has no attribute 'defaultaction' |
| missing attribute of module: warnings.onceregistry | 1 | test_warnings (1) | test.test_warnings._WarningsTests.test_onceregistry: AttributeError: AttributeError: module 'warnings' has no attribute 'onceregistry' |
| missing attribute of module: warnings._showwarnmsg | 1 | test_warnings (1) | test.test_warnings._WarningsTests.test_showwarnmsg_missing: AttributeError: AttributeError: module 'warnings' has no attribute '_showwarnmsg'. Did you |
| test.support.TestFailed | 1 | test_zipimport_support (1) | test.test_zipimport_support.ZipSupportTests.test_doctest_issue4197: test.support.TestFailed: test.support.TestFailed: 1 of 5 doctests failed |

## Since the last run

Tests passed: 34092 -> 34390.

| module | before | now |
|---|---|---|
| test_set | crashed, 320 passed | crashed, 618 passed |

## All modules

| module | status | ran | passed | failed | errors | skipped | CPython passes | seconds | reason |
|---|---|---|---|---|---|---|---|---|---|
| test___all__ | passed | 1 | 1 | 0 | 0 | 0 | 1 | 4.1 |  |
| test__colorize | passed | 8 | 6 | 0 | 0 | 2 | 7 | 0.9 |  |
| test__interpchannels | skipped | 0 | 0 | 0 | 0 | 0 | 68 | 0.7 | No module named '_interpchannels' |
| test__interpreters | skipped | 0 | 0 | 0 | 0 | 0 | 66 | 0.8 | No module named '_interpreters' |
| test__locale | passed | 6 | 0 | 0 | 0 | 6 | 0 | 0.8 |  |
| test__opcode | passed | 7 | 7 | 0 | 0 | 0 | 7 | 0.8 |  |
| test__osx_support | passed | 16 | 0 | 0 | 0 | 16 | 0 | 0.7 |  |
| test_abc | passed | 76 | 76 | 0 | 0 | 0 | 76 | 0.8 |  |
| test_abstract_numbers | passed | 7 | 7 | 0 | 0 | 0 | 7 | 0.7 |  |
| test_annotationlib | failed | 120 | 84 | 6 | 29 | 1 | 120 | 1.2 |  |
| test_argparse | failed | 1963 | 1962 | 1 | 0 | 0 | 1962 | 9.3 |  |
| test_array | passed | 1098 | 1043 | 0 | 0 | 55 | 1098 | 10.3 |  |
| test_asdl_parser | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.6 | test irrelevant for an installed Python |
| test_ast.test_ast | failed | 220 | 199 | 10 | 2 | 9 | 218 | 1.5 |  |
| test_asyncgen | failed | 85 | 81 | 4 | 0 | 0 | 85 | 2.6 |  |
| test_asyncio.test_base_events | failed | 118 | 116 | 1 | 1 | 0 | 117 | 4.5 |  |
| test_asyncio.test_buffered_proto | passed | 2 | 1 | 0 | 0 | 1 | 1 | 0.6 |  |
| test_asyncio.test_context | passed | 1 | 1 | 0 | 0 | 0 | 1 | 0.8 |  |
| test_asyncio.test_eager_task_factory | no result | 0 | 0 | 0 | 0 | 0 | 48 | 0.5 | AttributeError: module 'asyncio.tasks' has no attribute '_CTask'. Did you mean '.Task' instead of '._CTask'? |
| test_asyncio.test_events | failed | 305 | 271 | 3 | 1 | 30 | 279 | 32.3 |  |
| test_asyncio.test_free_threading | passed | 24 | 12 | 0 | 0 | 12 | 24 | 3.5 |  |
| test_asyncio.test_futures | passed | 189 | 64 | 0 | 0 | 125 | 189 | 73.8 |  |
| test_asyncio.test_futures2 | no result | 0 | 0 | 0 | 0 | 0 | 7 | 0.4 | AttributeError: module 'asyncio.tasks' has no attribute '_CTask'. Did you mean '.Task' instead of '._CTask'? |
| test_asyncio.test_graph | passed | 28 | 14 | 0 | 0 | 14 | 28 | 0.6 |  |
| test_asyncio.test_locks | passed | 75 | 75 | 0 | 0 | 0 | 75 | 1.5 |  |
| test_asyncio.test_pep492 | failed | 11 | 10 | 1 | 0 | 0 | 11 | 0.8 |  |
| test_asyncio.test_proactor_events | passed | 82 | 78 | 0 | 0 | 4 | 78 | 0.8 |  |
| test_asyncio.test_protocols | passed | 5 | 5 | 0 | 0 | 0 | 5 | 0.4 |  |
| test_asyncio.test_queues | passed | 59 | 59 | 0 | 0 | 0 | 59 | 0.9 |  |
| test_asyncio.test_runners | failed | 30 | 29 | 1 | 0 | 0 | 30 | 0.9 |  |
| test_asyncio.test_selector_events | passed | 131 | 131 | 0 | 0 | 0 | 131 | 0.9 |  |
| test_asyncio.test_sendfile | passed | 66 | 54 | 0 | 0 | 12 | 54 | 8.1 |  |
| test_asyncio.test_server | passed | 13 | 12 | 0 | 0 | 1 | 12 | 0.8 |  |
| test_asyncio.test_server_context | passed | 12 | 6 | 0 | 0 | 6 | 6 | 0.6 |  |
| test_asyncio.test_sock_lowlevel | passed | 45 | 45 | 0 | 0 | 0 | 45 | 5.7 |  |
| test_asyncio.test_ssl | passed | 24 | 0 | 0 | 0 | 24 | 0 | 0.5 |  |
| test_asyncio.test_sslproto | passed | 40 | 0 | 0 | 0 | 40 | 0 | 0.5 |  |
| test_asyncio.test_staggered | passed | 7 | 7 | 0 | 0 | 0 | 7 | 0.8 |  |
| test_asyncio.test_streams | failed | 76 | 69 | 3 | 0 | 4 | 72 | 1.4 |  |
| test_asyncio.test_subprocess | passed | 86 | 86 | 0 | 0 | 0 | 86 | 13.3 |  |
| test_asyncio.test_taskgroups | failed | 130 | 118 | 12 | 0 | 0 | 130 | 13.4 |  |
| test_asyncio.test_tasks | timeout | 1131 | 312 | 0 | 0 | 819 | 1133 | 303.2 | hang: test_tasks.PyTask_PyFuture_SubclassTests.test_task_not_crash_without_finalization; hang: test_tasks.PyTask_PyFuture_Tests.test_error_i |
| test_asyncio.test_threads | passed | 6 | 6 | 0 | 0 | 0 | 6 | 0.5 |  |
| test_asyncio.test_timeouts | passed | 34 | 34 | 0 | 0 | 0 | 34 | 1.0 |  |
| test_asyncio.test_tools | no result | 0 | 0 | 0 | 0 | 0 | 22 | 0.3 | ModuleNotFoundError: Standard library module '_remote_debugging' was not found |
| test_asyncio.test_transports | passed | 7 | 7 | 0 | 0 | 0 | 7 | 0.5 |  |
| test_asyncio.test_unix_events | passed | 90 | 85 | 0 | 0 | 5 | 90 | 1.0 |  |
| test_asyncio.test_waitfor | passed | 19 | 19 | 0 | 0 | 0 | 19 | 1.7 |  |
| test_asyncio.test_windows_events | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.5 | Windows only |
| test_asyncio.test_windows_utils | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.4 | Windows only |
| test_atexit | failed | 10 | 1 | 3 | 0 | 6 | 9 | 1.2 |  |
| test_audit | failed | 33 | 2 | 23 | 1 | 7 | 29 | 6.5 |  |
| test_augassign | passed | 7 | 7 | 0 | 0 | 0 | 7 | 0.4 |  |
| test_base64 | passed | 67 | 66 | 0 | 0 | 1 | 67 | 1.2 |  |
| test_baseexception | passed | 11 | 11 | 0 | 0 | 0 | 11 | 0.4 |  |
| test_bdb | failed | 37 | 6 | 31 | 0 | 0 | 37 | 1.2 |  |
| test_bigaddrspace | passed | 6 | 0 | 0 | 0 | 6 | 0 | 0.8 |  |
| test_bigmem | passed | 166 | 165 | 0 | 0 | 1 | 166 | 0.5 |  |
| test_binascii | passed | 237 | 220 | 0 | 0 | 17 | 220 | 0.5 |  |
| test_binop | passed | 12 | 12 | 0 | 0 | 0 | 12 | 0.5 |  |
| test_bisect | passed | 46 | 46 | 0 | 0 | 0 | 46 | 0.5 |  |
| test_bool | failed | 31 | 30 | 1 | 0 | 0 | 31 | 0.5 |  |
| test_buffer | passed | 97 | 15 | 0 | 0 | 82 | 95 | 0.8 |  |
| test_build_details | failed | 17 | 6 | 1 | 10 | 0 | 10 | 0.5 |  |
| test_builtin | failed | 143 | 112 | 12 | 5 | 14 | 149 | 1.4 |  |
| test_bytes | skipped | 0 | 0 | 0 | 0 | 0 | 331 | 0.5 | No module named '_testlimitedcapi' |
| test_bz2 | skipped | 0 | 0 | 0 | 0 | 0 | 101 | 0.3 | No module named '_bz2' |
| test_c_locale_coercion | passed | 8 | 2 | 0 | 0 | 6 | 7 | 1.6 |  |
| test_c_stack_unwind | skipped | 0 | 0 | 0 | 0 | 0 | 2 | 0.4 | No module named '_testinternalcapi' |
| test_calendar | passed | 86 | 81 | 0 | 0 | 5 | 81 | 7.2 |  |
| test_call | passed | 189 | 7 | 0 | 0 | 182 | 189 | 0.5 |  |
| test_charmapcodec | passed | 4 | 4 | 0 | 0 | 0 | 4 | 0.5 |  |
| test_class | no result | 0 | 0 | 0 | 0 | 0 | 42 | 0.4 | ModuleNotFoundError: No module named '_testinternalcapi' |
| test_cmath | passed | 33 | 32 | 0 | 0 | 1 | 33 | 0.5 |  |
| test_cmd | passed | 5 | 4 | 0 | 0 | 1 | 5 | 0.5 |  |
| test_cmd_line | failed | 82 | 46 | 5 | 4 | 27 | 69 | 13.0 |  |
| test_cmd_line_script | failed | 51 | 42 | 9 | 0 | 0 | 51 | 8.2 |  |
| test_code | failed | 37 | 6 | 7 | 5 | 19 | 41 | 0.8 |  |
| test_code_module | failed | 18 | 17 | 1 | 0 | 0 | 18 | 0.6 |  |
| test_codeccallbacks | failed | 44 | 43 | 1 | 0 | 0 | 44 | 0.4 |  |
| test_codecencodings_cn | failed | 76 | 0 | 0 | 76 | 0 | 74 | 0.6 |  |
| test_codecencodings_hk | failed | 19 | 0 | 0 | 19 | 0 | 19 | 0.5 |  |
| test_codecencodings_iso2022 | failed | 95 | 0 | 0 | 94 | 1 | 94 | 0.8 |  |
| test_codecencodings_jp | failed | 133 | 0 | 0 | 133 | 0 | 133 | 0.8 |  |
| test_codecencodings_kr | failed | 57 | 0 | 0 | 57 | 0 | 57 | 0.6 |  |
| test_codecencodings_tw | failed | 19 | 0 | 0 | 19 | 0 | 19 | 0.6 |  |
| test_codecmaps_cn | passed | 9 | 0 | 0 | 0 | 9 | 0 | 0.5 |  |
| test_codecmaps_hk | passed | 3 | 0 | 0 | 0 | 3 | 0 | 0.4 |  |
| test_codecmaps_jp | passed | 15 | 0 | 0 | 0 | 15 | 0 | 0.4 |  |
| test_codecmaps_kr | passed | 9 | 0 | 0 | 0 | 9 | 0 | 0.5 |  |
| test_codecmaps_tw | passed | 6 | 0 | 0 | 0 | 6 | 0 | 0.4 |  |
| test_codecs | failed | 288 | 241 | 19 | 5 | 23 | 274 | 3.8 |  |
| test_codeop | passed | 13 | 13 | 0 | 0 | 0 | 13 | 0.4 |  |
| test_collections | passed | 120 | 116 | 0 | 0 | 4 | 119 | 1.7 |  |
| test_colorsys | passed | 8 | 8 | 0 | 0 | 0 | 8 | 0.4 |  |
| test_compare | passed | 16 | 16 | 0 | 0 | 0 | 16 | 0.6 |  |
| test_compile | failed | 188 | 105 | 6 | 26 | 51 | 187 | 2.8 |  |
| test_compileall | skipped | 0 | 0 | 0 | 0 | 0 | 139 | 0.4 | No module named '_testmultiphase' |
| test_compiler_assemble | passed | 3 | 0 | 0 | 0 | 3 | 3 | 0.4 |  |
| test_compiler_codegen | passed | 5 | 0 | 0 | 0 | 5 | 5 | 0.4 |  |
| test_complex | failed | 38 | 35 | 1 | 1 | 1 | 38 | 0.5 |  |
| test_concurrent_futures.test_as_completed | no result | 0 | 0 | 0 | 0 | 0 | 25 | 0.4 | AttributeError: module 'concurrent.futures' has no attribute 'InterpreterPoolExecutor' |
| test_concurrent_futures.test_deadlock | no result | 0 | 0 | 0 | 0 | 0 | 48 | 0.4 | AttributeError: module 'concurrent.futures' has no attribute 'InterpreterPoolExecutor' |
| test_concurrent_futures.test_future | no result | 0 | 0 | 0 | 0 | 0 | 21 | 0.4 | AttributeError: module 'concurrent.futures' has no attribute 'InterpreterPoolExecutor' |
| test_concurrent_futures.test_init | no result | 0 | 0 | 0 | 0 | 0 | 12 | 0.4 | AttributeError: module 'concurrent.futures' has no attribute 'InterpreterPoolExecutor' |
| test_concurrent_futures.test_interpreter_pool | no result | 0 | 0 | 0 | 0 | 0 | 42 | 0.4 | ModuleNotFoundError: Standard library module '_interpreters' was not found |
| test_concurrent_futures.test_process_pool | no result | 0 | 0 | 0 | 0 | 0 | 121 | 0.4 | AttributeError: module 'concurrent.futures' has no attribute 'InterpreterPoolExecutor' |
| test_concurrent_futures.test_shutdown | no result | 0 | 0 | 0 | 0 | 0 | 51 | 0.4 | AttributeError: module 'concurrent.futures' has no attribute 'InterpreterPoolExecutor' |
| test_concurrent_futures.test_thread_pool | no result | 0 | 0 | 0 | 0 | 0 | 24 | 0.4 | AttributeError: module 'concurrent.futures' has no attribute 'InterpreterPoolExecutor' |
| test_concurrent_futures.test_wait | no result | 0 | 0 | 0 | 0 | 0 | 33 | 0.4 | AttributeError: module 'concurrent.futures' has no attribute 'InterpreterPoolExecutor' |
| test_configparser | passed | 383 | 378 | 0 | 0 | 5 | 378 | 2.9 |  |
| test_contains | passed | 4 | 4 | 0 | 0 | 0 | 4 | 0.4 |  |
| test_context | failed | 58 | 31 | 3 | 0 | 24 | 57 | 0.9 |  |
| test_contextlib | failed | 100 | 99 | 1 | 0 | 0 | 100 | 0.6 |  |
| test_contextlib_async | failed | 70 | 69 | 1 | 0 | 0 | 70 | 0.5 |  |
| test_copy | passed | 84 | 84 | 0 | 0 | 0 | 84 | 0.6 |  |
| test_copyreg | passed | 6 | 6 | 0 | 0 | 0 | 6 | 0.5 |  |
| test_coroutines | failed | 100 | 90 | 5 | 2 | 3 | 100 | 1.6 |  |
| test_crossinterp | skipped | 0 | 0 | 0 | 0 | 0 | 101 | 0.4 | No module named '_testinternalcapi' |
| test_csv | passed | 140 | 134 | 0 | 0 | 6 | 136 | 1.0 |  |
| test_curses | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.5 | Use of the 'curses' resource not enabled |
| test_dataclasses | failed | 285 | 273 | 5 | 4 | 3 | 285 | 1.2 |  |
| test_datetime | passed | 580 | 551 | 0 | 0 | 29 | 1127 | 4.3 |  |
| test_dbm | failed | 38 | 35 | 0 | 2 | 1 | 37 | 1.0 |  |
| test_dbm_dumb | passed | 28 | 28 | 0 | 0 | 0 | 28 | 0.6 |  |
| test_dbm_gnu | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | No module named '_gdbm' |
| test_dbm_ndbm | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.4 | No module named '_dbm' |
| test_dbm_sqlite3 | failed | 30 | 26 | 2 | 1 | 1 | 29 | 1.2 |  |
| test_decimal | passed | 587 | 383 | 0 | 0 | 204 | 384 | 3.1 |  |
| test_decorators | passed | 16 | 16 | 0 | 0 | 0 | 16 | 0.5 |  |
| test_defaultdict | passed | 13 | 13 | 0 | 0 | 0 | 13 | 0.4 |  |
| test_deque | passed | 82 | 79 | 0 | 0 | 3 | 81 | 2.8 |  |
| test_descr | crashed | 166 | 135 | 13 | 5 | 13 | 167 | 80.0 | hang: ClassPropertiesAndMethods.test_recursive_call; crash: MroTest.test_incomplete_super |
| test_descrtut | passed | 8 | 8 | 0 | 0 | 0 | 8 | 0.5 |  |
| test_devpoll | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | test works only on Solaris OS family |
| test_dict | failed | 145 | 127 | 5 | 1 | 12 | 145 | 18.0 |  |
| test_dictcomps | passed | 10 | 10 | 0 | 0 | 0 | 10 | 0.4 |  |
| test_dictviews | passed | 16 | 16 | 0 | 0 | 0 | 16 | 0.6 |  |
| test_difflib | passed | 61 | 60 | 0 | 0 | 1 | 61 | 1.2 |  |
| test_dis | no result | 0 | 0 | 0 | 0 | 0 | 145 | 0.4 | NotImplementedError: code.replace() cannot change co_linetable |
| test_doctest.test_doctest | failed | 73 | 73 | 0 | 0 | 0 | 74 | 4.4 | AssertionError: Failed example: |
| test_doctest.test_doctest2 | passed | 1 | 1 | 0 | 0 | 0 | 1 | 0.5 |  |
| test_docxmlrpc | passed | 9 | 9 | 0 | 0 | 0 | 9 | 4.8 |  |
| test_dtrace | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.4 | CPython must be configured with the --with-dtrace option. |
| test_dynamic | failed | 11 | 10 | 0 | 1 | 0 | 11 | 0.5 |  |
| test_dynamicclassattribute | passed | 12 | 11 | 0 | 0 | 1 | 11 | 0.4 |  |
| test_eintr | passed | 1 | 0 | 0 | 0 | 1 | 0 | 0.4 |  |
| test_email.test__encoded_words | failed | 39 | 38 | 1 | 0 | 0 | 39 | 0.5 |  |
| test_email.test__header_value_parser | passed | 389 | 389 | 0 | 0 | 0 | 389 | 0.7 |  |
| test_email.test_asian_codecs | skipped | 0 | 0 | 0 | 0 | 0 | 5 | 0.4 |  |
| test_email.test_contentmanager | failed | 116 | 113 | 0 | 3 | 0 | 116 | 0.6 |  |
| test_email.test_defect_handling | passed | 60 | 60 | 0 | 0 | 0 | 60 | 0.5 |  |
| test_email.test_email | failed | 542 | 534 | 1 | 5 | 2 | 540 | 5.1 |  |
| test_email.test_generator | failed | 83 | 82 | 1 | 0 | 0 | 83 | 0.7 |  |
| test_email.test_headerregistry | failed | 194 | 193 | 1 | 0 | 0 | 194 | 0.6 |  |
| test_email.test_inversion | passed | 5 | 5 | 0 | 0 | 0 | 5 | 0.5 |  |
| test_email.test_message | passed | 311 | 311 | 0 | 0 | 0 | 311 | 1.5 |  |
| test_email.test_parser | passed | 8 | 8 | 0 | 0 | 0 | 8 | 0.4 |  |
| test_email.test_pickleable | passed | 12 | 12 | 0 | 0 | 0 | 12 | 0.5 |  |
| test_email.test_policy | passed | 33 | 33 | 0 | 0 | 0 | 33 | 0.5 |  |
| test_email.test_utils | passed | 21 | 20 | 0 | 0 | 1 | 21 | 0.4 |  |
| test_ensurepip | passed | 33 | 33 | 0 | 0 | 0 | 33 | 0.6 |  |
| test_enum | passed | 1089 | 1084 | 0 | 0 | 5 | 1083 | 2.6 |  |
| test_enumerate | passed | 105 | 89 | 0 | 0 | 16 | 105 | 0.5 |  |
| test_eof | failed | 6 | 5 | 1 | 0 | 0 | 6 | 1.1 |  |
| test_epoll | passed | 11 | 11 | 0 | 0 | 0 | 11 | 0.6 |  |
| test_errno | passed | 3 | 3 | 0 | 0 | 0 | 3 | 0.4 |  |
| test_except_star | passed | 60 | 60 | 0 | 0 | 0 | 60 | 0.5 |  |
| test_exception_group | passed | 54 | 53 | 0 | 0 | 1 | 54 | 0.7 |  |
| test_exception_hierarchy | failed | 16 | 14 | 1 | 0 | 1 | 15 | 0.5 |  |
| test_exception_variations | passed | 30 | 30 | 0 | 0 | 0 | 30 | 0.4 |  |
| test_exceptions | timeout | 112 | 90 | 6 | 1 | 15 | 112 | 237.2 | hang: ExceptionTests.test_no_hang_on_context_chain_cycle1; hang: ExceptionTests.test_no_hang_on_context_chain_cycle2; hang: ExceptionTests.t |
| test_extcall | failed | 6 | 6 | 0 | 0 | 0 | 6 | 0.6 | AssertionError: Failed example: |
| test_external_inspection | skipped | 0 | 0 | 0 | 0 | 0 | 64 | 0.5 | Test only runs when _remote_debugging is available |
| test_faulthandler | failed | 51 | 27 | 13 | 0 | 11 | 45 | 16.8 |  |
| test_fcntl | passed | 14 | 11 | 0 | 0 | 3 | 13 | 1.1 |  |
| test_file_eintr | passed | 18 | 18 | 0 | 0 | 0 | 18 | 4.5 |  |
| test_filecmp | passed | 16 | 16 | 0 | 0 | 0 | 16 | 1.2 |  |
| test_fileinput | passed | 57 | 56 | 0 | 0 | 1 | 57 | 0.5 |  |
| test_fileutils | skipped | 0 | 0 | 0 | 0 | 0 | 1 | 0.3 | No module named '_testinternalcapi' |
| test_finalization | failed | 18 | 8 | 5 | 0 | 5 | 18 | 1.5 |  |
| test_float | failed | 54 | 47 | 4 | 0 | 3 | 53 | 0.6 |  |
| test_flufl | passed | 4 | 4 | 0 | 0 | 0 | 4 | 0.5 |  |
| test_fnmatch | passed | 24 | 24 | 0 | 0 | 0 | 24 | 0.5 |  |
| test_fork1 | skipped | 0 | 0 | 0 | 0 | 0 | 4 | 0.3 | test module requires working os.fork |
| test_format | passed | 19 | 16 | 0 | 0 | 3 | 19 | 0.5 |  |
| test_fractions | passed | 50 | 50 | 0 | 0 | 0 | 50 | 0.6 |  |
| test_frame | failed | 61 | 46 | 2 | 1 | 12 | 53 | 1.4 |  |
| test_free_threading.test_bisect | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | GIL enabled |
| test_free_threading.test_bytes_object | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | GIL enabled |
| test_free_threading.test_bz2 | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | GIL enabled |
| test_free_threading.test_capi | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.4 | GIL enabled |
| test_free_threading.test_code | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.4 | GIL enabled |
| test_free_threading.test_collections | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.4 | GIL enabled |
| test_free_threading.test_context | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.4 | GIL enabled |
| test_free_threading.test_cprofile | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.4 | GIL enabled |
| test_free_threading.test_csv | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.4 | GIL enabled |
| test_free_threading.test_datetime | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | GIL enabled |
| test_free_threading.test_dbm_gnu | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.4 | GIL enabled |
| test_free_threading.test_dict | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.4 | GIL enabled |
| test_free_threading.test_dict_watcher | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | GIL enabled |
| test_free_threading.test_enumerate | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | GIL enabled |
| test_free_threading.test_exceptions | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | GIL enabled |
| test_free_threading.test_frame | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.4 | GIL enabled |
| test_free_threading.test_func_annotations | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | GIL enabled |
| test_free_threading.test_functions | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | GIL enabled |
| test_free_threading.test_functools | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.5 | GIL enabled |
| test_free_threading.test_gc | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | GIL enabled |
| test_free_threading.test_generators | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | GIL enabled |
| test_free_threading.test_grp | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | GIL enabled |
| test_free_threading.test_heapq | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.4 | GIL enabled |
| test_free_threading.test_io | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.4 | GIL enabled |
| test_free_threading.test_iteration | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.4 | GIL enabled |
| test_free_threading.test_itertools | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.4 | GIL enabled |
| test_free_threading.test_itertools_combinatoric | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.4 | GIL enabled |
| test_free_threading.test_json | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.4 | GIL enabled |
| test_free_threading.test_list | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | GIL enabled |
| test_free_threading.test_lzma | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.4 | GIL enabled |
| test_free_threading.test_methodcaller | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.4 | GIL enabled |
| test_free_threading.test_mmap | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.4 | GIL enabled |
| test_free_threading.test_monitoring | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.4 | GIL enabled |
| test_free_threading.test_os | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.6 | GIL enabled |
| test_free_threading.test_pickle | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.4 | GIL enabled |
| test_free_threading.test_pwd | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | GIL enabled |
| test_free_threading.test_races | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.4 | GIL enabled |
| test_free_threading.test_re | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.4 | GIL enabled |
| test_free_threading.test_readline | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | GIL enabled |
| test_free_threading.test_resource | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.4 | GIL enabled |
| test_free_threading.test_reversed | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.4 | GIL enabled |
| test_free_threading.test_set | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | GIL enabled |
| test_free_threading.test_slots | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.4 | GIL enabled |
| test_free_threading.test_sqlite3 | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.4 | GIL enabled |
| test_free_threading.test_str | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | GIL enabled |
| test_free_threading.test_string_template_race | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | GIL enabled |
| test_free_threading.test_suggestions | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | GIL enabled |
| test_free_threading.test_sys | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.4 | GIL enabled |
| test_free_threading.test_syslog | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.4 | GIL enabled |
| test_free_threading.test_threading | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.4 | GIL enabled |
| test_free_threading.test_tokenize | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.4 | GIL enabled |
| test_free_threading.test_type | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | GIL enabled |
| test_free_threading.test_types | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | GIL enabled |
| test_free_threading.test_uuid | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | GIL enabled |
| test_free_threading.test_weakref | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.4 | GIL enabled |
| test_free_threading.test_zip | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | GIL enabled |
| test_free_threading.test_zlib | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.4 | GIL enabled |
| test_frozen | failed | 3 | 1 | 2 | 0 | 0 | 3 | 0.4 |  |
| test_fstring | failed | 96 | 93 | 1 | 1 | 1 | 95 | 1.8 |  |
| test_ftplib | passed | 96 | 51 | 0 | 0 | 45 | 51 | 2.9 |  |
| test_funcattrs | failed | 39 | 33 | 2 | 3 | 1 | 39 | 0.4 |  |
| test_functools | failed | 338 | 320 | 11 | 4 | 3 | 337 | 2.6 |  |
| test_future_stmt.test_future | failed | 23 | 22 | 1 | 0 | 0 | 23 | 1.0 |  |
| test_future_stmt.test_future_flags | failed | 2 | 1 | 0 | 1 | 0 | 2 | 0.4 |  |
| test_future_stmt.test_future_multiple_features | passed | 2 | 2 | 0 | 0 | 0 | 2 | 0.4 |  |
| test_future_stmt.test_future_multiple_imports | passed | 1 | 1 | 0 | 0 | 0 | 1 | 0.3 |  |
| test_future_stmt.test_future_single_import | passed | 3 | 3 | 0 | 0 | 0 | 3 | 0.3 |  |
| test_gc | timeout | 60 | 18 | 29 | 0 | 13 | 59 | 115.6 | hang: GCTests.test_trashcan_threads |
| test_gc_stats | skipped | 0 | 0 | 0 | 0 | 0 | 7 | 0.4 | Test only runs when _remote_debugging is available |
| test_generator_stop | passed | 2 | 2 | 0 | 0 | 0 | 2 | 0.4 |  |
| test_generators | failed | 59 | 56 | 2 | 0 | 1 | 59 | 0.9 |  |
| test_genericalias | failed | 37 | 36 | 1 | 0 | 0 | 37 | 0.5 |  |
| test_genericclass | passed | 22 | 21 | 0 | 0 | 1 | 22 | 0.4 |  |
| test_genericpath | passed | 26 | 26 | 0 | 0 | 0 | 26 | 0.5 |  |
| test_genexps | failed | 1 | 1 | 0 | 0 | 0 | 1 | 0.5 | AssertionError: Failed example: |
| test_getopt | passed | 10 | 10 | 0 | 0 | 0 | 9 | 0.8 |  |
| test_getpass | passed | 50 | 50 | 0 | 0 | 0 | 50 | 0.5 |  |
| test_getpath | failed | 32 | 4 | 0 | 28 | 0 | 32 | 1.1 |  |
| test_gettext | passed | 74 | 73 | 0 | 0 | 1 | 74 | 0.7 |  |
| test_glob | passed | 22 | 20 | 0 | 0 | 2 | 20 | 1.4 |  |
| test_global | passed | 20 | 20 | 0 | 0 | 0 | 20 | 0.4 |  |
| test_grammar | passed | 75 | 75 | 0 | 0 | 0 | 75 | 0.5 |  |
| test_graphlib | passed | 17 | 17 | 0 | 0 | 0 | 17 | 0.8 |  |
| test_grp | passed | 3 | 3 | 0 | 0 | 0 | 3 | 0.4 |  |
| test_gzip | passed | 78 | 78 | 0 | 0 | 0 | 78 | 3.0 |  |
| test_hash | failed | 30 | 11 | 6 | 3 | 10 | 30 | 1.6 |  |
| test_hashlib | passed | 93 | 78 | 0 | 0 | 15 | 79 | 4.0 |  |
| test_heapq | passed | 69 | 69 | 0 | 0 | 0 | 69 | 1.1 |  |
| test_hmac | passed | 147 | 144 | 0 | 0 | 3 | 144 | 0.8 |  |
| test_html | passed | 2 | 2 | 0 | 0 | 0 | 2 | 0.4 |  |
| test_htmlparser | passed | 68 | 66 | 0 | 0 | 2 | 66 | 0.6 |  |
| test_http_cookiejar | passed | 81 | 81 | 0 | 0 | 0 | 81 | 1.0 |  |
| test_http_cookies | passed | 35 | 34 | 0 | 0 | 1 | 34 | 0.5 |  |
| test_httplib | failed | 151 | 122 | 17 | 0 | 12 | 139 | 3.0 |  |
| test_httpservers | timeout | 101 | 93 | 0 | 0 | 8 | 95 | 156.6 | hang: RequestHandlerColorizedLoggingTestCase.test_get; hang: RequestHandlerLoggingTestCase.test_get |
| test_imaplib | passed | 239 | 122 | 0 | 0 | 117 | 123 | 21.8 |  |
| test_import | skipped | 0 | 0 | 0 | 0 | 0 | 125 | 0.4 | No module named '_testmultiphase' |
| test_importlib.builtin.test_finder | skipped | 0 | 0 | 0 | 0 | 0 | 4 | 0.4 | No module named '_testmultiphase' |
| test_importlib.builtin.test_loader | skipped | 0 | 0 | 0 | 0 | 0 | 8 | 0.4 | No module named '_testmultiphase' |
| test_importlib.extension.test_case_sensitivity | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.4 | No module named '_testmultiphase' |
| test_importlib.extension.test_finder | skipped | 0 | 0 | 0 | 0 | 0 | 6 | 0.3 | No module named '_testmultiphase' |
| test_importlib.extension.test_loader | skipped | 0 | 0 | 0 | 0 | 0 | 25 | 0.3 | No module named '_testmultiphase' |
| test_importlib.extension.test_path_hook | skipped | 0 | 0 | 0 | 0 | 0 | 2 | 0.3 | No module named '_testmultiphase' |
| test_importlib.frozen.test_finder | skipped | 0 | 0 | 0 | 0 | 0 | 12 | 0.3 | No module named '_testmultiphase' |
| test_importlib.frozen.test_loader | skipped | 0 | 0 | 0 | 0 | 0 | 18 | 0.3 | No module named '_testmultiphase' |
| test_importlib.import_.test___loader__ | skipped | 0 | 0 | 0 | 0 | 0 | 2 | 0.4 | No module named '_testmultiphase' |
| test_importlib.import_.test___package__ | skipped | 0 | 0 | 0 | 0 | 0 | 19 | 0.3 | No module named '_testmultiphase' |
| test_importlib.import_.test_api | skipped | 0 | 0 | 0 | 0 | 0 | 12 | 0.4 | No module named '_testmultiphase' |
| test_importlib.import_.test_caching | skipped | 0 | 0 | 0 | 0 | 0 | 9 | 0.3 | No module named '_testmultiphase' |
| test_importlib.import_.test_fromlist | skipped | 0 | 0 | 0 | 0 | 0 | 30 | 0.3 | No module named '_testmultiphase' |
| test_importlib.import_.test_helpers | skipped | 0 | 0 | 0 | 0 | 0 | 17 | 0.4 | No module named '_testmultiphase' |
| test_importlib.import_.test_meta_path | skipped | 0 | 0 | 0 | 0 | 0 | 10 | 0.4 | No module named '_testmultiphase' |
| test_importlib.import_.test_packages | skipped | 0 | 0 | 0 | 0 | 0 | 16 | 0.3 | No module named '_testmultiphase' |
| test_importlib.import_.test_path | skipped | 0 | 0 | 0 | 0 | 0 | 46 | 0.3 | No module named '_testmultiphase' |
| test_importlib.import_.test_relative_imports | skipped | 0 | 0 | 0 | 0 | 0 | 30 | 0.4 | No module named '_testmultiphase' |
| test_importlib.metadata.test_api | passed | 36 | 36 | 0 | 0 | 0 | 36 | 2.9 |  |
| test_importlib.metadata.test_main | passed | 39 | 38 | 0 | 0 | 1 | 38 | 1.2 |  |
| test_importlib.metadata.test_zip | passed | 17 | 15 | 0 | 0 | 2 | 17 | 0.5 |  |
| test_importlib.resources.test_compatibilty_files | no result | 0 | 0 | 0 | 0 | 0 | 0 | 0.4 | AttributeError: module 'importlib' has no attribute 'abc'. Did you mean '.resources.abc' instead of '.abc'? |
| test_importlib.resources.test_contents | no result | 0 | 0 | 0 | 0 | 0 | 0 | 0.4 | AttributeError: module 'importlib' has no attribute 'abc'. Did you mean '.resources.abc' instead of '.abc'? |
| test_importlib.resources.test_custom | no result | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | AttributeError: module 'importlib' has no attribute 'abc'. Did you mean '.resources.abc' instead of '.abc'? |
| test_importlib.resources.test_files | no result | 0 | 0 | 0 | 0 | 0 | 0 | 0.4 | AttributeError: module 'importlib' has no attribute 'abc'. Did you mean '.resources.abc' instead of '.abc'? |
| test_importlib.resources.test_functional | no result | 0 | 0 | 0 | 0 | 0 | 0 | 0.4 | AttributeError: module 'importlib' has no attribute 'abc'. Did you mean '.resources.abc' instead of '.abc'? |
| test_importlib.resources.test_open | no result | 0 | 0 | 0 | 0 | 0 | 0 | 0.4 | AttributeError: module 'importlib' has no attribute 'abc'. Did you mean '.resources.abc' instead of '.abc'? |
| test_importlib.resources.test_path | no result | 0 | 0 | 0 | 0 | 0 | 0 | 0.4 | AttributeError: module 'importlib' has no attribute 'abc'. Did you mean '.resources.abc' instead of '.abc'? |
| test_importlib.resources.test_read | no result | 0 | 0 | 0 | 0 | 0 | 0 | 0.5 | AttributeError: module 'importlib' has no attribute 'abc'. Did you mean '.resources.abc' instead of '.abc'? |
| test_importlib.resources.test_reader | no result | 0 | 0 | 0 | 0 | 0 | 0 | 0.4 | AttributeError: module 'importlib' has no attribute 'abc'. Did you mean '.resources.abc' instead of '.abc'? |
| test_importlib.resources.test_resource | no result | 0 | 0 | 0 | 0 | 0 | 0 | 0.4 | AttributeError: module 'importlib' has no attribute 'abc'. Did you mean '.resources.abc' instead of '.abc'? |
| test_importlib.resources.test_util | no result | 0 | 0 | 0 | 0 | 0 | 0 | 0.5 | AttributeError: module 'importlib' has no attribute 'abc'. Did you mean '.resources.abc' instead of '.abc'? |
| test_importlib.source.test_case_sensitivity | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.4 | No module named '_testmultiphase' |
| test_importlib.source.test_file_loader | skipped | 0 | 0 | 0 | 0 | 0 | 61 | 0.4 | No module named '_testmultiphase' |
| test_importlib.source.test_finder | skipped | 0 | 0 | 0 | 0 | 0 | 44 | 0.4 | No module named '_testmultiphase' |
| test_importlib.source.test_path_hook | skipped | 0 | 0 | 0 | 0 | 0 | 4 | 0.4 | No module named '_testmultiphase' |
| test_importlib.source.test_source_encoding | skipped | 0 | 0 | 0 | 0 | 0 | 20 | 0.3 | No module named '_testmultiphase' |
| test_importlib.test_abc | skipped | 0 | 0 | 0 | 0 | 0 | 105 | 0.5 | No module named '_testmultiphase' |
| test_importlib.test_api | skipped | 0 | 0 | 0 | 0 | 0 | 56 | 0.3 | No module named '_testmultiphase' |
| test_importlib.test_discover | skipped | 0 | 0 | 0 | 0 | 0 | 12 | 0.4 | No module named '_testmultiphase' |
| test_importlib.test_lazy | skipped | 0 | 0 | 0 | 0 | 0 | 15 | 0.3 | No module named '_testmultiphase' |
| test_importlib.test_locks | skipped | 0 | 0 | 0 | 0 | 0 | 34 | 0.3 | No module named '_testmultiphase' |
| test_importlib.test_namespace_pkgs | skipped | 0 | 0 | 0 | 0 | 0 | 30 | 0.3 | No module named '_testmultiphase' |
| test_importlib.test_pkg_import | passed | 1 | 1 | 0 | 0 | 0 | 1 | 0.4 |  |
| test_importlib.test_spec | skipped | 0 | 0 | 0 | 0 | 0 | 106 | 0.3 | No module named '_testmultiphase' |
| test_importlib.test_threaded_import | failed | 26 | 16 | 5 | 0 | 5 | 21 | 2.8 |  |
| test_importlib.test_util | skipped | 0 | 0 | 0 | 0 | 0 | 120 | 0.3 | No module named '_testmultiphase' |
| test_importlib.test_windows | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | No module named '_testmultiphase' |
| test_index | failed | 55 | 54 | 1 | 0 | 0 | 55 | 0.4 |  |
| test_inspect.test_inspect | failed | 382 | 309 | 6 | 21 | 46 | 382 | 3.4 |  |
| test_int | failed | 52 | 36 | 5 | 0 | 11 | 48 | 0.9 |  |
| test_int_literal | passed | 6 | 6 | 0 | 0 | 0 | 6 | 0.4 |  |
| test_interpreters.test_api | skipped | 0 | 0 | 0 | 0 | 0 | 99 | 0.3 | No module named '_interpreters' |
| test_interpreters.test_channels | skipped | 0 | 0 | 0 | 0 | 0 | 35 | 0.3 | No module named '_interpchannels' |
| test_interpreters.test_lifecycle | skipped | 0 | 0 | 0 | 0 | 0 | 2 | 0.3 | No module named '_interpreters' |
| test_interpreters.test_queues | skipped | 0 | 0 | 0 | 0 | 0 | 30 | 0.4 | No module named '_interpqueues' |
| test_interpreters.test_stress | skipped | 0 | 0 | 0 | 0 | 0 | 1 | 0.3 | No module named '_interpreters' |
| test_io.test_bufferedio | failed | 352 | 334 | 0 | 6 | 12 | 346 | 4.7 |  |
| test_io.test_file | passed | 36 | 34 | 0 | 0 | 2 | 34 | 0.9 |  |
| test_io.test_fileio | passed | 100 | 99 | 0 | 0 | 1 | 100 | 2.2 |  |
| test_io.test_general | failed | 145 | 131 | 1 | 0 | 13 | 141 | 4.9 |  |
| test_io.test_largefile | passed | 16 | 10 | 0 | 0 | 6 | 10 | 0.4 |  |
| test_io.test_memoryio | passed | 188 | 181 | 0 | 0 | 7 | 188 | 4.6 |  |
| test_io.test_signals | timeout | 14 | 6 | 0 | 0 | 8 | 8 | 158.0 | hang: test_signals.CSignalsTest.test_interrupted_write_buffered; hang: test_signals.CSignalsTest.test_interrupted_write_text |
| test_io.test_textio | failed | 169 | 157 | 2 | 7 | 3 | 167 | 11.4 |  |
| test_io.test_univnewlines | passed | 34 | 34 | 0 | 0 | 0 | 34 | 0.5 |  |
| test_ioctl | passed | 4 | 4 | 0 | 0 | 0 | 4 | 1.0 |  |
| test_ipaddress | passed | 212 | 212 | 0 | 0 | 0 | 212 | 0.7 |  |
| test_isinstance | passed | 23 | 23 | 0 | 0 | 0 | 23 | 0.8 |  |
| test_iter | failed | 57 | 53 | 1 | 1 | 2 | 57 | 0.6 |  |
| test_iterlen | passed | 22 | 22 | 0 | 0 | 0 | 22 | 0.4 |  |
| test_itertools | failed | 136 | 114 | 0 | 0 | 22 | 132 | 3.5 | AssertionError: TypeError not raised |
| test_json.test_decode | passed | 42 | 42 | 0 | 0 | 0 | 42 | 0.5 |  |
| test_json.test_default | passed | 6 | 6 | 0 | 0 | 0 | 6 | 0.4 |  |
| test_json.test_dump | passed | 23 | 23 | 0 | 0 | 0 | 23 | 0.5 |  |
| test_json.test_encode_basestring_ascii | passed | 7 | 6 | 0 | 0 | 1 | 6 | 0.4 |  |
| test_json.test_enum | passed | 14 | 14 | 0 | 0 | 0 | 14 | 0.4 |  |
| test_json.test_fail | passed | 14 | 14 | 0 | 0 | 0 | 14 | 0.4 |  |
| test_json.test_float | passed | 8 | 8 | 0 | 0 | 0 | 8 | 0.5 |  |
| test_json.test_indent | passed | 4 | 4 | 0 | 0 | 0 | 4 | 0.5 |  |
| test_json.test_pass1 | passed | 2 | 2 | 0 | 0 | 0 | 2 | 0.5 |  |
| test_json.test_pass2 | passed | 2 | 2 | 0 | 0 | 0 | 2 | 0.5 |  |
| test_json.test_pass3 | passed | 2 | 2 | 0 | 0 | 0 | 2 | 0.4 |  |
| test_json.test_pickleable | passed | 1 | 1 | 0 | 0 | 0 | 1 | 0.6 |  |
| test_json.test_recursion | passed | 12 | 10 | 0 | 0 | 2 | 10 | 0.8 |  |
| test_json.test_scanstring | passed | 8 | 8 | 0 | 0 | 0 | 8 | 0.5 |  |
| test_json.test_separators | passed | 4 | 4 | 0 | 0 | 0 | 4 | 0.5 |  |
| test_json.test_speedups | passed | 12 | 12 | 0 | 0 | 0 | 12 | 0.7 |  |
| test_json.test_tool | passed | 34 | 34 | 0 | 0 | 0 | 34 | 9.3 |  |
| test_json.test_unicode | passed | 34 | 34 | 0 | 0 | 0 | 34 | 1.5 |  |
| test_keyword | passed | 11 | 11 | 0 | 0 | 0 | 11 | 0.3 |  |
| test_keywordonlyarg | passed | 11 | 11 | 0 | 0 | 0 | 11 | 0.5 |  |
| test_kqueue | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | test works only on BSD |
| test_lazy_import | crashed | 165 | 155 | 4 | 2 | 4 | 166 | 23.2 | crash: LazyImportTypeTests.test_deeply_dotted_name |
| test_linecache | passed | 36 | 36 | 0 | 0 | 0 | 36 | 1.0 |  |
| test_list | failed | 69 | 62 | 5 | 0 | 2 | 69 | 1.3 |  |
| test_listcomps | passed | 65 | 65 | 0 | 0 | 0 | 65 | 0.5 |  |
| test_lltrace | passed | 3 | 0 | 0 | 0 | 3 | 0 | 0.4 |  |
| test_locale | passed | 45 | 40 | 0 | 0 | 5 | 41 | 0.5 |  |
| test_logging | timeout | 288 | 280 | 0 | 2 | 6 | 284 | 102.8 | hang: RotatingFileHandlerTest.test_should_not_rollover_named_pipe |
| test_long | failed | 48 | 39 | 1 | 0 | 8 | 48 | 3.4 |  |
| test_longexp | passed | 1 | 1 | 0 | 0 | 0 | 1 | 0.4 |  |
| test_lzma | skipped | 0 | 0 | 0 | 0 | 0 | 120 | 0.4 | No module named '_lzma' |
| test_mailbox | passed | 386 | 381 | 0 | 0 | 5 | 383 | 7.0 |  |
| test_marshal | failed | 82 | 60 | 4 | 2 | 16 | 75 | 1.7 |  |
| test_math | passed | 89 | 86 | 0 | 0 | 3 | 87 | 2.3 |  |
| test_math_integer | passed | 19 | 17 | 0 | 0 | 2 | 19 | 1.7 |  |
| test_math_property | passed | 2 | 0 | 0 | 0 | 2 | 0 | 0.4 |  |
| test_memoryview | passed | 173 | 153 | 0 | 0 | 20 | 154 | 1.6 |  |
| test_metaclass | passed | 1 | 1 | 0 | 0 | 0 | 1 | 0.4 |  |
| test_mimetypes | passed | 46 | 42 | 0 | 0 | 4 | 43 | 2.2 |  |
| test_minidom | passed | 133 | 132 | 0 | 0 | 1 | 132 | 0.5 |  |
| test_mmap | failed | 55 | 47 | 0 | 1 | 7 | 48 | 2.5 |  |
| test_module | failed | 39 | 37 | 2 | 0 | 0 | 39 | 0.8 |  |
| test_modulefinder | failed | 18 | 2 | 16 | 0 | 0 | 18 | 1.5 |  |
| test_monitoring | failed | 100 | 10 | 87 | 1 | 2 | 100 | 0.8 |  |
| test_multibytecodec | no result | 0 | 0 | 0 | 0 | 0 | 38 | 0.4 | ModuleNotFoundError: Standard library module '_multibytecodec' was not found |
| test_multiprocessing_fork.test_manager | failed | 11 | 0 | 0 | 11 | 0 | 69 | 1.0 |  |
| test_multiprocessing_fork.test_misc | failed | 91 | 27 | 4 | 41 | 19 | 73 | 10.6 |  |
| test_multiprocessing_fork.test_processes | failed | 138 | 47 | 2 | 65 | 24 | 155 | 14.0 |  |
| test_multiprocessing_fork.test_threads | failed | 111 | 74 | 1 | 1 | 35 | 78 | 15.1 |  |
| test_multiprocessing_forkserver.test_manager | skipped | 0 | 0 | 0 | 0 | 0 | 69 | 0.3 | requires working os.fork() |
| test_multiprocessing_forkserver.test_misc | skipped | 0 | 0 | 0 | 0 | 0 | 83 | 0.3 | requires working os.fork() |
| test_multiprocessing_forkserver.test_preload | skipped | 0 | 0 | 0 | 0 | 0 | 14 | 0.4 | requires working os.fork() |
| test_multiprocessing_forkserver.test_processes | skipped | 0 | 0 | 0 | 0 | 0 | 163 | 0.3 | requires working os.fork() |
| test_multiprocessing_forkserver.test_threads | skipped | 0 | 0 | 0 | 0 | 0 | 78 | 0.4 | requires working os.fork() |
| test_multiprocessing_main_handling | failed | 39 | 12 | 27 | 0 | 0 | 39 | 18.5 |  |
| test_multiprocessing_spawn.test_manager | passed | 82 | 67 | 0 | 0 | 15 | 69 | 28.5 |  |
| test_multiprocessing_spawn.test_misc | failed | 91 | 40 | 6 | 29 | 16 | 77 | 17.1 |  |
| test_multiprocessing_spawn.test_processes | failed | 166 | 138 | 3 | 0 | 25 | 157 | 66.6 |  |
| test_multiprocessing_spawn.test_threads | failed | 111 | 75 | 1 | 0 | 35 | 78 | 16.2 |  |
| test_named_expressions | passed | 74 | 74 | 0 | 0 | 0 | 74 | 0.4 |  |
| test_netrc | passed | 25 | 24 | 0 | 0 | 1 | 24 | 0.5 |  |
| test_ntpath | passed | 110 | 83 | 0 | 0 | 27 | 83 | 1.1 |  |
| test_nturl2path | passed | 6 | 6 | 0 | 0 | 0 | 6 | 0.4 |  |
| test_numeric_tower | passed | 9 | 9 | 0 | 0 | 0 | 9 | 0.7 |  |
| test_opcache | skipped | 0 | 0 | 0 | 0 | 0 | 83 | 0.3 | implementation detail specific to cpython |
| test_opcodes | passed | 8 | 8 | 0 | 0 | 0 | 8 | 0.4 |  |
| test_openpty | passed | 1 | 1 | 0 | 0 | 0 | 1 | 0.4 |  |
| test_operator | failed | 112 | 109 | 0 | 3 | 0 | 112 | 0.6 |  |
| test_optimizer | skipped | 0 | 0 | 0 | 0 | 0 | 5 | 0.4 | No module named '_testinternalcapi' |
| test_optparse | passed | 155 | 153 | 0 | 0 | 2 | 154 | 0.7 |  |
| test_ordered_dict | failed | 299 | 275 | 12 | 4 | 8 | 299 | 1.7 |  |
| test_os.test_os | failed | 366 | 309 | 3 | 3 | 51 | 334 | 18.7 |  |
| test_os.test_posix | failed | 186 | 143 | 1 | 2 | 40 | 150 | 4.4 |  |
| test_os.test_windows | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.4 | Win32 specific tests |
| test_osx_env | passed | 1 | 0 | 0 | 0 | 1 | 0 | 0.3 |  |
| test_pathlib.test_copy | passed | 52 | 48 | 0 | 0 | 4 | 48 | 1.0 |  |
| test_pathlib.test_join | passed | 63 | 63 | 0 | 0 | 0 | 63 | 1.5 |  |
| test_pathlib.test_join_posix | passed | 6 | 6 | 0 | 0 | 0 | 6 | 0.4 |  |
| test_pathlib.test_join_windows | passed | 30 | 30 | 0 | 0 | 0 | 30 | 0.4 |  |
| test_pathlib.test_pathlib | failed | 1151 | 753 | 0 | 6 | 392 | 757 | 15.8 |  |
| test_pathlib.test_read | failed | 63 | 53 | 0 | 4 | 6 | 57 | 1.4 |  |
| test_pathlib.test_write | passed | 33 | 27 | 0 | 0 | 6 | 27 | 0.5 |  |
| test_patma | failed | 343 | 334 | 8 | 1 | 0 | 343 | 0.5 |  |
| test_pdb | timeout | 6 | 4 | 1 | 1 | 0 | 224 | 684.7 | hang: PdbTestCase.test_async_break; hang: PdbTestCase.test_blocks_at_first_code_line; hang: PdbTestCase.test_breakpoint; hang: PdbTestCase.t |
| test_peepholer | failed | 143 | 13 | 4 | 35 | 91 | 142 | 1.4 |  |
| test_pep646_syntax | failed | 1 | 1 | 0 | 0 | 0 | 1 | 0.4 | AssertionError: Failed example: |
| test_perf_profiler | skipped | 0 | 0 | 0 | 0 | 0 | 10 | 0.3 | perf trampoline profiling not supported |
| test_perfmaps | skipped | 0 | 0 | 0 | 0 | 0 | 2 | 0.3 | requires _testinternalcapi |
| test_pickle | failed | 1085 | 1012 | 3 | 0 | 70 | 1033 | 14.4 |  |
| test_picklebuffer | passed | 9 | 6 | 0 | 0 | 3 | 9 | 0.4 |  |
| test_pickletools | passed | 204 | 189 | 0 | 0 | 15 | 189 | 3.3 |  |
| test_pkg | passed | 8 | 8 | 0 | 0 | 0 | 8 | 0.5 |  |
| test_pkgutil | skipped | 0 | 0 | 0 | 0 | 0 | 22 | 0.4 | No module named '_testmultiphase' |
| test_platform | failed | 39 | 33 | 0 | 1 | 5 | 35 | 0.8 |  |
| test_plistlib | failed | 72 | 68 | 2 | 0 | 2 | 70 | 1.5 |  |
| test_poll | passed | 7 | 5 | 0 | 0 | 2 | 6 | 1.5 |  |
| test_popen | passed | 5 | 5 | 0 | 0 | 0 | 5 | 0.6 |  |
| test_poplib | passed | 74 | 23 | 0 | 0 | 51 | 23 | 0.9 |  |
| test_positional_only_arg | failed | 28 | 27 | 0 | 1 | 0 | 28 | 0.4 |  |
| test_posixpath | passed | 96 | 91 | 0 | 0 | 5 | 92 | 1.0 |  |
| test_pow | passed | 7 | 7 | 0 | 0 | 0 | 7 | 1.2 |  |
| test_pprint | failed | 77 | 74 | 2 | 0 | 1 | 77 | 0.6 |  |
| test_print | passed | 9 | 9 | 0 | 0 | 0 | 9 | 0.4 |  |
| test_profile | failed | 7 | 5 | 2 | 0 | 0 | 7 | 1.0 |  |
| test_profiling.test_heatmap | passed | 50 | 50 | 0 | 0 | 0 | 50 | 0.8 |  |
| test_profiling.test_sampling_profiler.test_advanced | skipped | 0 | 0 | 0 | 0 | 0 | 5 | 0.3 | Test only runs when _remote_debugging is available |
| test_profiling.test_sampling_profiler.test_async | skipped | 0 | 0 | 0 | 0 | 0 | 22 | 0.3 | Test only runs when _remote_debugging is available |
| test_profiling.test_sampling_profiler.test_binary_format | skipped | 0 | 0 | 0 | 0 | 0 | 79 | 0.4 | Test only runs when _remote_debugging is available |
| test_profiling.test_sampling_profiler.test_blocking | skipped | 0 | 0 | 0 | 0 | 0 | 1 | 0.4 | Test only runs when _remote_debugging is available |
| test_profiling.test_sampling_profiler.test_children | skipped | 0 | 0 | 0 | 0 | 0 | 32 | 0.4 | Test only runs when _remote_debugging is available |
| test_profiling.test_sampling_profiler.test_cli | skipped | 0 | 0 | 0 | 0 | 0 | 55 | 0.3 | Test only runs when _remote_debugging is available |
| test_profiling.test_sampling_profiler.test_collectors | skipped | 0 | 0 | 0 | 0 | 0 | 114 | 0.4 | Test only runs when _remote_debugging is available |
| test_profiling.test_sampling_profiler.test_dump | passed | 17 | 16 | 0 | 0 | 1 | 17 | 0.4 |  |
| test_profiling.test_sampling_profiler.test_integration | skipped | 0 | 0 | 0 | 0 | 0 | 21 | 0.4 | Test only runs when _remote_debugging is available |
| test_profiling.test_sampling_profiler.test_live_collector_core | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | Use of the 'curses' resource not enabled |
| test_profiling.test_sampling_profiler.test_live_collector_interaction | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | Use of the 'curses' resource not enabled |
| test_profiling.test_sampling_profiler.test_live_collector_ui | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | Use of the 'curses' resource not enabled |
| test_profiling.test_sampling_profiler.test_modes | skipped | 0 | 0 | 0 | 0 | 0 | 15 | 0.3 | Test only runs when _remote_debugging is available |
| test_profiling.test_sampling_profiler.test_profiler | skipped | 0 | 0 | 0 | 0 | 0 | 29 | 0.3 | Test only runs when _remote_debugging is available |
| test_profiling.test_sampling_profiler.test_sync_coordinator | passed | 2 | 2 | 0 | 0 | 0 | 2 | 0.7 |  |
| test_profiling.test_sampling_profiler.test_trend_tracker | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | Use of the 'curses' resource not enabled |
| test_profiling.test_tracing_profiler | failed | 30 | 16 | 10 | 4 | 0 | 30 | 2.5 |  |
| test_property | failed | 31 | 26 | 1 | 2 | 2 | 29 | 0.4 |  |
| test_pstats | failed | 13 | 10 | 1 | 1 | 1 | 13 | 0.7 |  |
| test_pty | failed | 6 | 4 | 0 | 2 | 0 | 6 | 0.4 |  |
| test_pulldom | passed | 11 | 11 | 0 | 0 | 0 | 11 | 0.4 |  |
| test_pwd | passed | 3 | 3 | 0 | 0 | 0 | 3 | 0.4 |  |
| test_py_compile | passed | 34 | 34 | 0 | 0 | 0 | 34 | 1.6 |  |
| test_pyclbr | skipped | 0 | 0 | 0 | 0 | 0 | 6 | 0.4 | No module named '_testmultiphase' |
| test_pydoc.test_pydoc | failed | 119 | 98 | 14 | 1 | 6 | 119 | 4.1 |  |
| test_pyexpat | failed | 89 | 85 | 0 | 0 | 4 | 89 | 0.8 | LookupError: unknown encoding: Shift_JISX0213 |
| test_pyrepl.test_eventqueue | passed | 26 | 13 | 0 | 0 | 13 | 13 | 0.5 |  |
| test_pyrepl.test_fancycompleter | passed | 21 | 21 | 0 | 0 | 0 | 21 | 0.4 |  |
| test_pyrepl.test_input | passed | 10 | 10 | 0 | 0 | 0 | 10 | 0.3 |  |
| test_pyrepl.test_interact | failed | 29 | 28 | 1 | 0 | 0 | 29 | 0.5 |  |
| test_pyrepl.test_keymap | passed | 17 | 17 | 0 | 0 | 0 | 17 | 0.4 |  |
| test_pyrepl.test_layout | passed | 36 | 36 | 0 | 0 | 0 | 36 | 0.4 |  |
| test_pyrepl.test_pyrepl | passed | 134 | 86 | 0 | 0 | 48 | 86 | 3.7 |  |
| test_pyrepl.test_reader | passed | 33 | 33 | 0 | 0 | 0 | 33 | 2.5 |  |
| test_pyrepl.test_render | passed | 31 | 31 | 0 | 0 | 0 | 31 | 0.4 |  |
| test_pyrepl.test_terminfo | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | Use of the 'curses' resource not enabled |
| test_pyrepl.test_unix_console | passed | 21 | 20 | 0 | 0 | 1 | 20 | 0.8 |  |
| test_pyrepl.test_utils | passed | 4 | 4 | 0 | 0 | 0 | 4 | 0.4 |  |
| test_pyrepl.test_windows_console | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | test only relevant on win32 |
| test_pystats | passed | 5 | 0 | 0 | 0 | 5 | 0 | 0.3 |  |
| test_queue | passed | 165 | 158 | 0 | 0 | 7 | 159 | 13.1 |  |
| test_quopri | passed | 11 | 11 | 0 | 0 | 0 | 11 | 0.5 |  |
| test_raise | passed | 37 | 37 | 0 | 0 | 0 | 37 | 0.4 |  |
| test_random | failed | 116 | 110 | 0 | 1 | 5 | 114 | 1.9 |  |
| test_range | passed | 29 | 29 | 0 | 0 | 0 | 29 | 1.2 |  |
| test_re | failed | 168 | 153 | 0 | 1 | 14 | 164 | 2.2 |  |
| test_readline | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | No module named 'readline' |
| test_regrtest | failed | 124 | 113 | 2 | 0 | 9 | 117 | 42.3 |  |
| test_remote_pdb | skipped | 0 | 0 | 0 | 0 | 0 | 48 | 0.5 | remote debugging is disabled |
| test_repl | failed | 18 | 4 | 11 | 0 | 3 | 18 | 2.9 |  |
| test_reprlib | failed | 33 | 30 | 0 | 1 | 2 | 31 | 0.5 |  |
| test_resource | passed | 14 | 14 | 0 | 0 | 0 | 14 | 0.6 |  |
| test_richcmp | passed | 11 | 11 | 0 | 0 | 0 | 11 | 0.5 |  |
| test_rlcompleter | failed | 11 | 9 | 2 | 0 | 0 | 11 | 0.5 |  |
| test_robotparser | passed | 107 | 107 | 0 | 0 | 0 | 107 | 0.6 |  |
| test_runpy | skipped | 0 | 0 | 0 | 0 | 0 | 41 | 0.4 | No module named '_testmultiphase' |
| test_samply_profiler | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | perf trampoline profiling not supported |
| test_sax | passed | 192 | 192 | 0 | 0 | 0 | 192 | 0.8 |  |
| test_sched | passed | 11 | 11 | 0 | 0 | 0 | 11 | 1.0 |  |
| test_scope | passed | 41 | 38 | 0 | 0 | 3 | 41 | 0.4 |  |
| test_script_helper | passed | 10 | 10 | 0 | 0 | 0 | 10 | 0.8 |  |
| test_secrets | passed | 11 | 11 | 0 | 0 | 0 | 11 | 0.4 |  |
| test_select | passed | 6 | 5 | 0 | 0 | 1 | 6 | 1.4 |  |
| test_selectors | passed | 121 | 77 | 0 | 0 | 44 | 77 | 14.6 |  |
| test_set | crashed | 624 | 618 | 6 | 0 | 0 | 644 | 59.1 | crash: TestBinaryOpsMutating_Set_Set.test_ior_with_mutation; crash: TestBinaryOpsMutating_Set_Set.test_ixor_with_mutation; crash: TestBinary |
| test_setcomps | passed | 2 | 2 | 0 | 0 | 0 | 2 | 0.4 |  |
| test_shelve | passed | 274 | 271 | 0 | 0 | 3 | 271 | 4.5 |  |
| test_shlex | passed | 45 | 44 | 0 | 0 | 1 | 45 | 0.5 |  |
| test_shutil | passed | 227 | 176 | 0 | 0 | 51 | 178 | 3.2 |  |
| test_signal | passed | 57 | 44 | 0 | 0 | 13 | 52 | 25.1 |  |
| test_site | failed | 97 | 86 | 4 | 0 | 7 | 91 | 3.2 |  |
| test_slice | passed | 11 | 11 | 0 | 0 | 0 | 11 | 0.5 |  |
| test_smtplib | passed | 85 | 85 | 0 | 0 | 0 | 85 | 2.1 |  |
| test_smtpnet | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.4 | No module named '_ssl' |
| test_socket | failed | 751 | 613 | 1 | 2 | 135 | 620 | 47.2 |  |
| test_socketserver | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | Use of the 'network' resource not enabled |
| test_sort | failed | 21 | 18 | 3 | 0 | 0 | 21 | 0.7 |  |
| test_source_encoding | failed | 94 | 89 | 2 | 2 | 1 | 93 | 4.6 |  |
| test_sqlite3.test_backup | passed | 15 | 15 | 0 | 0 | 0 | 15 | 0.4 |  |
| test_sqlite3.test_cli | passed | 19 | 19 | 0 | 0 | 0 | 19 | 0.7 |  |
| test_sqlite3.test_dbapi | failed | 206 | 203 | 0 | 1 | 2 | 206 | 1.0 |  |
| test_sqlite3.test_dump | passed | 8 | 8 | 0 | 0 | 0 | 8 | 0.4 |  |
| test_sqlite3.test_factory | passed | 28 | 28 | 0 | 0 | 0 | 28 | 0.5 |  |
| test_sqlite3.test_hooks | passed | 32 | 31 | 0 | 0 | 1 | 32 | 0.5 |  |
| test_sqlite3.test_regression | passed | 38 | 38 | 0 | 0 | 0 | 38 | 0.6 |  |
| test_sqlite3.test_transactions | passed | 48 | 48 | 0 | 0 | 0 | 48 | 0.9 |  |
| test_sqlite3.test_types | passed | 48 | 46 | 0 | 0 | 2 | 46 | 0.5 |  |
| test_sqlite3.test_userfunctions | failed | 74 | 71 | 1 | 0 | 2 | 72 | 0.5 |  |
| test_ssl | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.5 | No module named '_ssl' |
| test_stable_abi_ctypes | skipped | 0 | 0 | 0 | 0 | 0 | 2 | 0.4 | requires _testcapi |
| test_startfile | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.4 | object <module 'os' from '<Lib>/os.py'> has no attribute 'startfile' |
| test_stat | passed | 22 | 18 | 0 | 0 | 4 | 18 | 0.4 |  |
| test_statistics | passed | 400 | 394 | 0 | 0 | 6 | 395 | 2.7 |  |
| test_str | timeout | 138 | 121 | 6 | 0 | 11 | 133 | 81.1 | hang: StrTest.test_adaptive_find |
| test_strftime | passed | 4 | 4 | 0 | 0 | 0 | 4 | 0.7 |  |
| test_string.test_string | passed | 42 | 41 | 0 | 0 | 1 | 42 | 0.4 |  |
| test_string.test_templatelib | passed | 13 | 13 | 0 | 0 | 0 | 13 | 0.5 |  |
| test_string_literals | passed | 20 | 20 | 0 | 0 | 0 | 20 | 0.6 |  |
| test_stringprep | no result | 0 | 0 | 0 | 0 | 0 | 1 | 0.4 | AssertionError |
| test_strptime | passed | 60 | 49 | 0 | 0 | 11 | 49 | 0.6 |  |
| test_strtod | passed | 9 | 8 | 0 | 0 | 1 | 8 | 1.1 |  |
| test_struct | failed | 47 | 40 | 1 | 0 | 6 | 47 | 1.4 |  |
| test_structseq | failed | 25 | 24 | 1 | 0 | 0 | 25 | 0.7 |  |
| test_subclassinit | passed | 17 | 17 | 0 | 0 | 0 | 17 | 0.4 |  |
| test_subprocess | failed | 366 | 303 | 9 | 7 | 47 | 323 | 41.7 |  |
| test_sundry | passed | 1 | 1 | 0 | 0 | 0 | 1 | 0.4 |  |
| test_super | failed | 40 | 36 | 0 | 1 | 3 | 40 | 0.5 |  |
| test_support | passed | 77 | 69 | 0 | 0 | 8 | 72 | 6.9 |  |
| test_symtable | failed | 42 | 41 | 0 | 1 | 0 | 42 | 0.6 |  |
| test_syntax | failed | 109 | 93 | 0 | 0 | 16 | 109 | 1.1 | AssertionError: Failed example: |
| test_sys | failed | 105 | 46 | 8 | 0 | 51 | 97 | 4.5 |  |
| test_sys_setprofile | failed | 29 | 4 | 25 | 0 | 0 | 29 | 0.5 |  |
| test_sys_settrace | timeout | 447 | 13 | 355 | 2 | 77 | 447 | 79.8 | hang: JumpTestCase.test_no_jump_infinite_while_loop |
| test_sysconfig | failed | 43 | 27 | 4 | 3 | 9 | 40 | 1.0 |  |
| test_syslog | failed | 12 | 8 | 0 | 1 | 3 | 12 | 0.7 |  |
| test_tabnanny | passed | 21 | 21 | 0 | 0 | 0 | 21 | 1.3 |  |
| test_tarfile | passed | 781 | 564 | 0 | 0 | 217 | 777 | 50.0 |  |
| test_tempfile | failed | 121 | 109 | 0 | 1 | 11 | 115 | 3.9 |  |
| test_termios | passed | 21 | 21 | 0 | 0 | 0 | 21 | 1.0 |  |
| test_textwrap | passed | 68 | 68 | 0 | 0 | 0 | 68 | 0.5 |  |
| test_thread | passed | 36 | 34 | 0 | 0 | 2 | 36 | 2.9 |  |
| test_thread_local_bytecode | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | No module named '_testinternalcapi' |
| test_threadedtempfile | passed | 1 | 0 | 0 | 0 | 1 | 0 | 0.4 |  |
| test_threading | failed | 247 | 213 | 2 | 1 | 31 | 243 | 19.5 |  |
| test_threading_local | passed | 22 | 18 | 0 | 0 | 4 | 22 | 2.5 |  |
| test_threadsignals | passed | 6 | 4 | 0 | 0 | 2 | 6 | 3.4 |  |
| test_time | passed | 65 | 49 | 0 | 0 | 16 | 62 | 3.5 |  |
| test_timeit | passed | 44 | 44 | 0 | 0 | 0 | 44 | 0.4 |  |
| test_timeout | passed | 1 | 0 | 0 | 0 | 1 | 0 | 0.4 |  |
| test_tokenize | passed | 132 | 132 | 0 | 0 | 0 | 132 | 2.2 |  |
| test_tomllib.test_data | passed | 2 | 2 | 0 | 0 | 0 | 2 | 0.4 |  |
| test_tomllib.test_error | passed | 8 | 8 | 0 | 0 | 0 | 8 | 0.4 |  |
| test_tomllib.test_misc | passed | 9 | 9 | 0 | 0 | 0 | 9 | 0.6 |  |
| test_trace | failed | 27 | 7 | 17 | 2 | 1 | 26 | 2.8 |  |
| test_traceback | failed | 441 | 183 | 10 | 2 | 246 | 440 | 9.6 |  |
| test_tracemalloc | failed | 51 | 26 | 10 | 4 | 11 | 51 | 1.7 |  |
| test_tstring | passed | 17 | 16 | 0 | 0 | 1 | 16 | 0.8 |  |
| test_tty | passed | 4 | 4 | 0 | 0 | 0 | 4 | 0.3 |  |
| test_tuple | failed | 39 | 33 | 2 | 0 | 4 | 39 | 0.7 |  |
| test_type_aliases | failed | 34 | 33 | 0 | 1 | 0 | 34 | 0.6 |  |
| test_type_annotations | crashed | 48 | 45 | 1 | 1 | 1 | 49 | 0.9 | crash: RegressionTests.test_conditional_annotations_rebound |
| test_type_cache | skipped | 0 | 0 | 0 | 0 | 0 | 12 | 0.3 | No module named '_testcapi' |
| test_type_comments | failed | 18 | 11 | 6 | 0 | 1 | 18 | 0.4 |  |
| test_type_params | failed | 109 | 109 | 0 | 0 | 0 | 109 | 0.5 | AssertionError: "<class 'int'>" != 'int' |
| test_typechecks | passed | 6 | 6 | 0 | 0 | 0 | 6 | 0.3 |  |
| test_types | no result | 0 | 0 | 0 | 0 | 0 | 135 | 0.3 | ModuleNotFoundError: Standard library module '_datetime' was not found |
| test_typing | failed | 739 | 724 | 1 | 11 | 3 | 742 | 1.5 |  |
| test_ucn | failed | 18 | 13 | 0 | 3 | 2 | 16 | 2.1 |  |
| test_unary | passed | 6 | 6 | 0 | 0 | 0 | 6 | 0.4 |  |
| test_unicode_file | passed | 2 | 2 | 0 | 0 | 0 | 2 | 0.4 |  |
| test_unicode_file_functions | passed | 30 | 30 | 0 | 0 | 0 | 30 | 0.9 |  |
| test_unicode_identifiers | passed | 3 | 3 | 0 | 0 | 0 | 3 | 0.4 |  |
| test_unicodedata | failed | 73 | 53 | 12 | 0 | 8 | 66 | 5.0 |  |
| test_unittest.test_assertions | passed | 35 | 35 | 0 | 0 | 0 | 35 | 0.6 |  |
| test_unittest.test_async_case | passed | 14 | 14 | 0 | 0 | 0 | 14 | 1.4 |  |
| test_unittest.test_break | passed | 48 | 46 | 0 | 0 | 2 | 46 | 0.6 |  |
| test_unittest.test_case | passed | 116 | 115 | 0 | 0 | 1 | 116 | 0.8 |  |
| test_unittest.test_discovery | skipped | 0 | 0 | 0 | 0 | 0 | 26 | 0.3 | No module named '_testmultiphase' |
| test_unittest.test_functiontestcase | passed | 8 | 8 | 0 | 0 | 0 | 8 | 0.4 |  |
| test_unittest.test_loader | passed | 84 | 84 | 0 | 0 | 0 | 84 | 0.7 |  |
| test_unittest.test_program | passed | 25 | 25 | 0 | 0 | 0 | 25 | 1.9 |  |
| test_unittest.test_result | passed | 57 | 57 | 0 | 0 | 0 | 57 | 0.4 |  |
| test_unittest.test_runner | passed | 52 | 52 | 0 | 0 | 0 | 52 | 1.5 |  |
| test_unittest.test_setups | passed | 17 | 17 | 0 | 0 | 0 | 17 | 0.4 |  |
| test_unittest.test_skipping | passed | 25 | 25 | 0 | 0 | 0 | 25 | 0.5 |  |
| test_unittest.test_suite | passed | 28 | 28 | 0 | 0 | 0 | 28 | 0.4 |  |
| test_unittest.test_util | passed | 6 | 6 | 0 | 0 | 0 | 6 | 0.4 |  |
| test_unpack | passed | 2 | 2 | 0 | 0 | 0 | 2 | 0.4 |  |
| test_unpack_ex | failed | 6 | 6 | 0 | 0 | 0 | 6 | 0.5 | AssertionError: Failed example: |
| test_unparse | passed | 81 | 81 | 0 | 0 | 0 | 81 | 1.8 |  |
| test_urllib | passed | 106 | 100 | 0 | 0 | 6 | 100 | 0.6 |  |
| test_urllib2 | passed | 85 | 79 | 0 | 0 | 6 | 79 | 0.8 |  |
| test_urllib2_localnet | passed | 21 | 19 | 0 | 0 | 2 | 19 | 2.1 |  |
| test_urllib2net | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.4 | Use of the 'network' resource not enabled |
| test_urllib_response | passed | 4 | 4 | 0 | 0 | 0 | 4 | 0.4 |  |
| test_urllibnet | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.4 | Use of the 'network' resource not enabled |
| test_urlparse | passed | 81 | 78 | 0 | 0 | 3 | 78 | 1.1 |  |
| test_userdict | passed | 28 | 28 | 0 | 0 | 0 | 28 | 0.8 |  |
| test_userlist | passed | 54 | 54 | 0 | 0 | 0 | 54 | 0.9 |  |
| test_userstring | timeout | 70 | 68 | 0 | 0 | 2 | 70 | 81.2 | hang: UserStringTest.test_adaptive_find |
| test_utf8_mode | failed | 12 | 11 | 0 | 0 | 1 | 11 | 3.3 | AssertionError: "['h\\xe9\\u20ac']" != "['h\\udcc3\\udca9\\udce2\\udc82\\udcac']" |
| test_utf8source | passed | 3 | 3 | 0 | 0 | 0 | 3 | 0.4 |  |
| test_uuid | passed | 120 | 48 | 0 | 0 | 72 | 49 | 0.7 |  |
| test_venv | failed | 42 | 31 | 1 | 1 | 9 | 33 | 15.3 |  |
| test_wait3 | skipped | 0 | 0 | 0 | 0 | 0 | 3 | 0.3 | requires working os.fork() |
| test_wait4 | skipped | 0 | 0 | 0 | 0 | 0 | 2 | 0.3 | requires working os.fork() |
| test_warnings | failed | 205 | 161 | 28 | 4 | 12 | 199 | 3.4 |  |
| test_wave | passed | 146 | 133 | 0 | 0 | 13 | 133 | 0.7 |  |
| test_weakref | failed | 140 | 120 | 8 | 1 | 11 | 136 | 14.2 |  |
| test_weakset | failed | 46 | 45 | 1 | 0 | 0 | 46 | 2.3 |  |
| test_webbrowser | passed | 64 | 45 | 0 | 0 | 19 | 45 | 0.5 |  |
| test_with | no result | 0 | 0 | 0 | 0 | 0 | 55 | 0.3 | ModuleNotFoundError: No module named '_testinternalcapi' |
| test_wsgiref | passed | 46 | 46 | 0 | 0 | 0 | 46 | 0.8 |  |
| test_xml | failed | 2 | 1 | 1 | 0 | 0 | 2 | 0.4 |  |
| test_xml_dom_minicompat | passed | 11 | 11 | 0 | 0 | 0 | 11 | 0.4 |  |
| test_xml_dom_xmlbuilder | passed | 4 | 4 | 0 | 0 | 0 | 4 | 0.6 |  |
| test_xml_etree | failed | 238 | 232 | 3 | 0 | 3 | 235 | 6.8 |  |
| test_xml_etree_c | failed | 256 | 232 | 3 | 0 | 21 | 252 | 6.0 |  |
| test_xmlrpc | passed | 94 | 85 | 0 | 0 | 9 | 85 | 1.2 |  |
| test_xpickle | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | Use of the 'xpickle' resource not enabled |
| test_xxlimited | skipped | 0 | 0 | 0 | 0 | 0 | 12 | 0.3 | No module named 'xxlimited' |
| test_xxtestfuzz | skipped | 0 | 0 | 0 | 0 | 0 | 1 | 0.3 | No module named '_xxtestfuzz' |
| test_yield_from | failed | 43 | 42 | 0 | 1 | 0 | 43 | 0.5 |  |
| test_zipapp | passed | 36 | 36 | 0 | 0 | 0 | 36 | 0.8 |  |
| test_zipfile._path.test_complexity | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | Unable to import big_o |
| test_zipfile._path.test_path | passed | 56 | 55 | 0 | 0 | 1 | 55 | 1.3 |  |
| test_zipfile.test_core | no result | 0 | 0 | 0 | 0 | 0 | 330 | 0.4 | LookupError: unknown encoding: shift_jis |
| test_zipfile64 | skipped | 0 | 0 | 0 | 0 | 0 | 0 | 0.3 | test requires loads of disk-space bytes and a long time to run |
| test_zipimport | passed | 152 | 137 | 0 | 0 | 15 | 143 | 1.0 |  |
| test_zipimport_support | failed | 5 | 2 | 1 | 2 | 0 | 5 | 1.6 |  |
| test_zlib | passed | 88 | 84 | 0 | 0 | 4 | 86 | 1.1 |  |
| test_zoneinfo.test_zoneinfo | skipped | 0 | 0 | 0 | 0 | 0 | 226 | 0.3 | No module named '_lzma' |
| test_zoneinfo.test_zoneinfo_property | passed | 23 | 23 | 0 | 0 | 0 | 23 | 0.6 |  |
| test_zstd | passed | 121 | 121 | 0 | 0 | 0 | 121 | 3.1 |  |

## Not run

| package | why |
|---|---|
| test_android | Android |
| test_apple | iOS |
| test_capi | the C API |
| test_cext | builds an extension module |
| test_clinic | Argument Clinic |
| test_ctypes | ctypes |
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
