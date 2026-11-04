# The tests of CPython's standard library, translated to TypeScript: the score

- Files: 821. Test methods in them: 32613.
- Translated: 31923 (97.9%). Left out: 690.
- Tests run (a method counts once for each class that inherits it): 40888; the originals run 40885 under the same bun.
- Pass: 36529 (89.3% of those run).
- Fail: 1741. Crash: 2. Timeout: 11. Need something that was left out: 645. Need JavaScript on a second thread: 1554.
- Fail as the original does under the same bun (no matter of the translation): 806.
- Methods in files that fail to load: 66.

## Why test methods were left out

| Methods | Reason                                       |
| ------: | -------------------------------------------- |
|     302 | syntax: Match                                |
|      93 | the file: the namespace of the module        |
|      73 | syntax: TryStar                              |
|      62 | frames                                       |
|      49 | type parameters                              |
|      34 | the file: syntax: TypeAlias                  |
|      23 | syntax: TemplateStr                          |
|      13 | syntax: TypeAlias                            |
|      13 | **class** as a variable                      |
|       9 | the namespace of the module                  |
|       6 | not in a test case at the top of the file    |
|       5 | raise without an exception outside a handler |
|       2 | a global variable in the place of a built-in |
|       2 | yield in a lambda                            |
|       1 | class with **keywords                        |
|       1 | await outside an async function              |
|       1 | syntax: del                                  |
|       1 | super() or **class** outside a method        |

## Failures whose cause is known

| Tests | Files | Cause                                                                                              | Example                                                                                               |
| ----: | ----: | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
|   876 |    30 | the test is about its own code: tracing, frames, code objects, bytecode                            | test_annotationlib TestCallAnnotateFunction.test_error_from_value_raised                              |
|    81 |     4 | a test that needed JavaScript on a second thread was interrupted and left something behind         | test_docxmlrpc DocXMLRPCHTTPGETServer.test_annotations                                                |
|    51 |     9 | no exception is being handled in a `catch`: **context**, sys.exception(), traceback.format_exc()   | test_contextlib TestExitStack.test_exit_exception_chaining                                            |
|    49 |    23 | a warning given under with() of bun:python is attributed to the frame of with()                    | test_argparse TestFileTypeDeprecation.test                                                            |
|    40 |    14 | a function of JavaScript has no code object, closure, defaults, annotations, signature or **dict** | test_builtin BuiltinTest.test_exec_closure                                                            |
|    39 |    14 | a whole float that a call returns is an int when it goes back                                      | test_builtin BuiltinTest.test_round                                                                   |
|    36 |     7 | a function of JavaScript cannot be pickled, copied by reference or weakly referenced               | test_builtin BuiltinTest.test_filter_pickle                                                           |
|    23 |     2 | dir() of a function of JavaScript lists 'arguments', 'caller' and 'callee', which throw            | test_unittest.testmock.testhelpers SpecSignatureTest.test_create_autospec_keyword_only_arguments      |
|    19 |     4 | for what JavaScript calls, the loop that Bun runs is the running loop                              | test_logging ConfigDictTest.test_config15_ok                                                          |
|    13 |     5 | a generator of JavaScript is not a generator object of Python's                                    | test_collections TestCounter.test_multiset_operations                                                 |
|     8 |     1 | to call a coroutine function from JavaScript gives a promise                                       | test_asyncio.test_tasks PyTask_CFutureSubclass_Tests.test_as_completed_async_iterator_cancelled_anext |
|     6 |     5 | a call of what cannot be called, and the like, is a TypeError of JavaScript's                      | test_descr ClassPropertiesAndMethods.test_assign_bases_many_subclasses                                |
|     5 |     4 | what goes by the frame of the caller finds none of the test's                                      | test_builtin BuiltinTest.test_sentinel_pickle                                                         |
|     5 |     2 | a view that was dropped still counts as an export under a frame of the optimizing compilers        | test_io.test_file PyOtherFileTests.testIteration                                                      |
|     3 |     1 | a coroutine made of a generator is not a coroutine object of Python's                              | test_unittest.testmock.testasync AsyncMockAssert.test_assert_has_calls_not_awaits                     |

## The other failures, by message

| Tests | Files | Message                                                                                                           | Example                                                                                              |
| ----: | ----: | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
|    73 |    14 | AssertionError: TypeError not raised                                                                              | test_array ByteTest.test_clear                                                                       |
|    38 |     1 | (the file) TypeError: **class** must be set to a class, not 'NoneType' object                                     | test_super                                                                                           |
|    38 |     5 | AssertionError: RuntimeError not raised                                                                           | test_asyncio.test_base_events BaseEventLoopTests.test_custom_run_forever_integration                 |
|    28 |     1 | (the file) AttributeError: 'JSFunction' object has no attribute '**code**'                                        | test_sys_setprofile                                                                                  |
|    23 |    13 | AssertionError: N != N                                                                                            | test_builtin BuiltinTest.test_dir                                                                    |
|    14 |     1 | AttributeError: 'NoneType' object has no attribute 'clear'                                                        | test_warnings CWarnTests.test_filename_module                                                        |
|    12 |     3 | IndexError: list index out of range                                                                               | test_zipimport DeflateCompressedZipImportTestCase.testTraceback                                      |
|    11 |     7 | timeout: timeout                                                                                                  | test_exceptions ExceptionTests.testInfiniteRecursion                                                 |
|     8 |     1 | AssertionError: Tuples differ: (<class 'ValueError'>, ('cancelled',), N) != …, N)                                 | test_asyncio.test_tasks CTaskSubclass_PyFuture_Tests.test_cancellation_exception_context             |
|     8 |     1 | AssertionError: "<Tas[N chars]uch()> cb=[<Dummy>()]>" != "<Tas[N chars]uch() running at …/release[N chars](<>)]>" | test_asyncio.test_tasks CTaskSubclass_PyFuture_Tests.test_task_repr                                  |
|     8 |     1 | AssertionError: True is not false                                                                                 | test_asyncio.test_tasks CTaskSubclass_PyFuture_Tests.test_tb_logger_not_called_after_cancel          |
|     8 |     3 | AssertionError: expected call not found.                                                                          | test_unittest.testmock.testhelpers SpecSignatureTest.test_autospec_functions_with_self_in_odd_place  |
|     7 |     3 | AssertionError: TypeError not raised by read                                                                      | test_bz2 BZ2FileTest.testRead                                                                        |
|     6 |     1 | AssertionError: Lists differ: …r()]] != []                                                                        | test_asyncio.test_futures CFutureTests.test_future_cancelled_exception_refcycles                     |
|     6 |     1 | FileNotFoundError: [Errno N] No such file or directory: 'bar'                                                     | test_unittest.testmock.testwith TestMockOpen.test_dunder_iter_data                                   |
|     5 |     1 | OSError: TarFile is closed                                                                                        | test_tarfile Bz2WriteTest.test_filter                                                                |
|     4 |     1 | TypeError: 'async for' requires an object with **aiter** method, got coroutine                                    | test_contextlib_async AsyncContextManagerTestCase.test_decorator_decorate_asyncgen_function          |
|     4 |     3 | AssertionError: … != …                                                                                            | test_functools TestLRUC.test_get_annotations_with_forwardref                                         |
|     4 |     2 | AssertionError: NameError not raised                                                                              | test_typing NamedTupleTests.test_deferred_annotations                                                |
|     4 |     1 | ExceptionGroup: unhandled errors in a TaskGroup (N sub-exceptions)                                                | test_asyncio.test_free_threading TestCFreeThreading.test_run_coroutine_threadsafe                    |
|     4 |     1 | AssertionError: Lists differ: …[]]]] != …, [['T<anon>[N chars][]]]]                                               | test_asyncio.test_graph TestCallStackC.test_stack_as_completed                                       |
|     4 |     1 | AssertionError: Lists differ: …[]]]] != …, [['[N chars][]]]]                                                      | test_asyncio.test_graph TestCallStackC.test_stack_gather                                             |
|     4 |     1 | AssertionError: Lists differ: …[]]]] != …, [[[N chars][]]]]                                                       | test_asyncio.test_graph TestCallStackC.test_stack_timeout                                            |
|     4 |     1 | AssertionError: Element counts were not equal:                                                                    | test_asyncio.test_tasks CTaskSubclass_PyFuture_Tests.test_as_completed_plain_iterator_cancelled_wait |
|     4 |     1 | asyncio.exceptions.CancelledError:                                                                                | test_asyncio.test_tasks CTaskSubclass_PyFuture_Tests.test_uncancel_structured_blocks                 |
|     4 |     1 | FileNotFoundError: [Errno N] No such file or directory: 'foo'                                                     | test_unittest.testmock.testwith TestMockOpen.test_explicit_mock                                      |
|     3 |     3 | AssertionError: 'N' != 'N'                                                                                        | test_builtin BuiltinTest.test_sum                                                                    |
|     3 |     3 | AssertionError: N != -N                                                                                           | test_complex ComplexTest.test_constructor_negative_nans_from_string                                  |
|     3 |     2 | AssertionError: Lists differ: [N, N] != [N]                                                                       | test_contextlib TestContextDecorator.test_contextmanager_decorate_asyncgen_function                  |
|     3 |     1 | AssertionError: '' != 'ERROR:root:just testing\nGot a [RuntimeError]\n'                                           | test_logging ConfigDictTest.test_config4_ok                                                          |
|     3 |     3 | AssertionError: False is not true                                                                                 | test_math MathTests.test_signbit                                                                     |
|     3 |     1 | NotImplementedError: The cipher suites of TLS N cannot be configured in BoringSSL.                                | test_ssl SimpleBackgroundTestsTLS_1_3.test_ciphersuite_downgrade                                     |
|     3 |     1 | ValueError: unable to get the source of <JavaScript function _fakefunc at Nx…>                                    | test_asyncio.test_futures CFutureTests.test_future_repr                                              |
|     3 |     1 | AssertionError: TypeError not raised by <MagicMock name='mock.one.__name__' id='N'>                               | test_unittest.testmock.testhelpers SpecSignatureTest.test_attributes                                 |
|     3 |     1 | FileNotFoundError: [Errno N] No such file or directory: 'abc'                                                     | test_unittest.testmock.testwith TestMockOpen.test_read_bytes                                         |
|     3 |     1 | AssertionError: sentinel.Something != <MagicMock name='something' id='N'> : unpatched                             | test_unittest.testmock.testwith WithTest.test_with_statement_as                                      |
|     2 |     1 | KeyError: N                                                                                                       | test_builtin BuiltinTest.test_max                                                                    |
|     2 |     1 | AssertionError: 'N,N,N,N[N chars]\r\n' != 'N,N,N,N[N chars]\r\n'                                                  | test_csv TestArrayWrites.test_double_write                                                           |
|     2 |     2 | AssertionError: 'N' != '-N'                                                                                       | test_float FormatTestCase.test_format_testfile                                                       |
|     2 |     1 | AssertionError: <JavaScript function bound f at Nx…> is not <JavaScript function f at Nx…>                        | test_functools TestUpdateWrapper.test_no_update                                                      |
