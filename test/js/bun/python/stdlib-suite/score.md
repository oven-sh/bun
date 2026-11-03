# The tests of CPython's standard library, translated to TypeScript: the score

- Files: 821. Test methods in them: 32613.
- Translated: 31362 (96.2%). Left out: 1251.
- Tests run (a method counts once for each class that inherits it): 40050; the originals run 40095 under the same bun.
- Pass: 35144 (87.8% of those run).
- Fail: 1722. Crash: 3. Timeout: 11. Need something that was left out: 1321. Need JavaScript on a second thread: 1553.
- Fail as the original does under the same bun (no matter of the translation): 615.
- Methods in files that fail to load: 66.

## Why test methods were left out

| Methods | Reason                                       |
| ------: | -------------------------------------------- |
|     455 | frames                                       |
|     302 | syntax: Match                                |
|     171 | the file: frames                             |
|      93 | the file: the namespace of the module        |
|      73 | syntax: TryStar                              |
|      49 | type parameters                              |
|      34 | the file: syntax: TypeAlias                  |
|      23 | syntax: TemplateStr                          |
|      13 | syntax: TypeAlias                            |
|      12 | **class** as a variable                      |
|       8 | the namespace of the module                  |
|       6 | not in a test case at the top of the file    |
|       5 | raise without an exception outside a handler |
|       2 | a global variable in the place of a built-in |
|       2 | yield in a lambda                            |
|       1 | await outside an async function              |
|       1 | syntax: del                                  |
|       1 | super() or **class** outside a method        |

## Failures whose cause is known

| Tests | Files | Cause                                                                                              | Example                                                                           |
| ----: | ----: | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
|   870 |    29 | the test is about its own code: tracing, frames, code objects, bytecode                            | test_annotationlib TestCallAnnotateFunction.test_error_from_value_raised          |
|    52 |    10 | no exception is being handled in a `catch`: **context**, sys.exception(), traceback.format_exc()   | test_contextlib TestExitStack.test_exit_exception_chaining                        |
|    40 |    14 | a whole float that a call returns is an int when it goes back                                      | test_builtin BuiltinTest.test_round                                               |
|    39 |    13 | a function of JavaScript has no code object, closure, defaults, annotations, signature or **dict** | test_builtin BuiltinTest.test_exec_closure                                        |
|    36 |     7 | a function of JavaScript cannot be pickled, copied by reference or weakly referenced               | test_builtin BuiltinTest.test_filter_pickle                                       |
|    27 |     4 | to call a coroutine function from JavaScript gives a promise                                       | test_logging ConfigDictTest.test_config15_ok                                      |
|    13 |     5 | a generator of JavaScript is not a generator object of Python's                                    | test_collections TestCounter.test_multiset_operations                             |
|     6 |     5 | a call of what cannot be called, and the like, is a TypeError of JavaScript's                      | test_descr ClassPropertiesAndMethods.test_assign_bases_many_subclasses            |
|     5 |     4 | what goes by the frame of the caller finds none of the test's                                      | test_builtin BuiltinTest.test_sentinel_pickle                                     |
|     4 |     1 | a coroutine made of a generator is not a coroutine object of Python's                              | test_unittest.testmock.testasync AsyncMockAssert.test_assert_has_calls_not_awaits |

## The other failures, by message

| Tests | Files | Message                                                                                                           | Example                                                                                              |
| ----: | ----: | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
|    66 |     1 | AssertionError: Unexpected handlers: [<StreamHandler (NOTSET)>]                                                   | test_logging EncodingTest.test_encoding_cyrillic_unicode                                             |
|    38 |     1 | (the file) TypeError: **class** must be set to a class, not 'NoneType' object                                     | test_super                                                                                           |
|    38 |     5 | AssertionError: RuntimeError not raised                                                                           | test_asyncio.test_base_events BaseEventLoopTests.test_custom_run_forever_integration                 |
|    31 |     8 | AssertionError: TypeError not raised                                                                              | test_functools TestCmpToKeyPy.test_cmp_to_key_arguments                                              |
|    28 |     1 | (the file) AttributeError: 'JSFunction' object has no attribute '**code**'                                        | test_sys_setprofile                                                                                  |
|    23 |     2 | JS TypeError: 'arguments', 'callee', and 'caller' cannot be accessed in this context.                             | test_unittest.testmock.testhelpers SpecSignatureTest.test_create_autospec_keyword_only_arguments     |
|    22 |    12 | AssertionError: N != N                                                                                            | test_contextlib ContextManagerTestCase.test_contextmanager_traceback                                 |
|    17 |    10 | RuntimeError: generator raised StopIteration                                                                      | test_contextlib TestContextDecorator.test_contextmanager_decorate_coroutine_function                 |
|    13 |     1 | AssertionError: '<frozen _bun_python>' != '…/test_gettext.py'                                                     | test_gettext GNUTranslationsClassPluralFormsTestCase.test_plural_context_forms                       |
|    12 |     3 | IndexError: list index out of range                                                                               | test_zipimport DeflateCompressedZipImportTestCase.testTraceback                                      |
|    11 |     7 | timeout: timeout                                                                                                  | test_exceptions ExceptionTests.testInfiniteRecursion                                                 |
|     9 |     2 | RuntimeError: Event loop stopped before Future completed.                                                         | test_asyncio.test_server SelectorStartServerTests.test_start_server_1                                |
|     8 |     1 | AssertionError: Tuples differ: (<class 'ValueError'>, ('cancelled',), N) != …, N)                                 | test_asyncio.test_tasks CTaskSubclass_PyFuture_Tests.test_cancellation_exception_context             |
|     8 |     1 | AssertionError: "<Tas[N chars]uch()> cb=[<Dummy>()]>" != "<Tas[N chars]uch() running at …/release[N chars](<>)]>" | test_asyncio.test_tasks CTaskSubclass_PyFuture_Tests.test_task_repr                                  |
|     8 |     1 | AssertionError: True is not false                                                                                 | test_asyncio.test_tasks CTaskSubclass_PyFuture_Tests.test_tb_logger_not_called_after_cancel          |
|     7 |     3 | AssertionError: TypeError not raised by read                                                                      | test_bz2 BZ2FileTest.testRead                                                                        |
|     7 |     1 | AssertionError: '<frozen _bun_python>' != '…/test_re.py'                                                          | test_re ReTests.test_basic_re_sub                                                                    |
|     6 |     1 | http.client.RemoteDisconnected: Remote end closed connection without response                                     | test_docxmlrpc DocXMLRPCHTTPGETServer.test_annotations                                               |
|     6 |     6 | AssertionError: False is not true                                                                                 | test_math MathTests.test_signbit                                                                     |
|     6 |     1 | AssertionError: Lists differ: …r()]] != []                                                                        | test_asyncio.test_futures CFutureTests.test_future_cancelled_exception_refcycles                     |
|     6 |     2 | AssertionError: expected call not found.                                                                          | test_unittest.testmock.testhelpers SpecSignatureTest.test_autospec_functions_with_self_in_odd_place  |
|     6 |     1 | FileNotFoundError: [Errno N] No such file or directory: 'bar'                                                     | test_unittest.testmock.testwith TestMockOpen.test_dunder_iter_data                                   |
|     5 |     1 | ValueError: Unable to configure formatter 'formN'                                                                 | test_logging ConfigDictTest.test_config4_ok                                                          |
|     5 |     1 | OSError: TarFile is closed                                                                                        | test_tarfile Bz2WriteTest.test_filter                                                                |
|     5 |     2 | BufferError: Existing exports of data: object cannot be re-sized                                                  | test_io.test_file PyOtherFileTests.testIteration                                                     |
|     4 |     1 | AssertionError: '<frozen _bun_python>' != '…/test_argparse.py'                                                    | test_argparse TestFileTypeDeprecation.test                                                           |
|     4 |     1 | TypeError: 'async for' requires an object with **aiter** method, got coroutine                                    | test_contextlib_async AsyncContextManagerTestCase.test_decorator_decorate_asyncgen_function          |
|     4 |     4 | JS throw: null                                                                                                    | test_epoll TestEPoll.test_control_and_wait                                                           |
|     4 |     3 | AssertionError: … != …                                                                                            | test_functools TestLRUC.test_get_annotations_with_forwardref                                         |
|     4 |     2 | AssertionError: NameError not raised                                                                              | test_typing NamedTupleTests.test_deferred_annotations                                                |
|     4 |     1 | ExceptionGroup: unhandled errors in a TaskGroup (N sub-exceptions)                                                | test_asyncio.test_free_threading TestCFreeThreading.test_run_coroutine_threadsafe                    |
|     4 |     1 | AssertionError: Lists differ: …[]]]] != …, [['T<anon>[N chars][]]]]                                               | test_asyncio.test_graph TestCallStackC.test_stack_as_completed                                       |
|     4 |     1 | AssertionError: Lists differ: …[]]]] != …, [['[N chars][]]]]                                                      | test_asyncio.test_graph TestCallStackC.test_stack_gather                                             |
|     4 |     1 | AssertionError: Lists differ: …[]]]] != …, [[[N chars][]]]]                                                       | test_asyncio.test_graph TestCallStackC.test_stack_timeout                                            |
|     4 |     1 | AssertionError: Element counts were not equal:                                                                    | test_asyncio.test_tasks CTaskSubclass_PyFuture_Tests.test_as_completed_plain_iterator_cancelled_wait |
|     4 |     1 | asyncio.exceptions.CancelledError:                                                                                | test_asyncio.test_tasks CTaskSubclass_PyFuture_Tests.test_uncancel_structured_blocks                 |
|     4 |     2 | AssertionError: Tuples differ: ('flush',) != ('close',)                                                           | test_io.test_bufferedio CBufferedRandomTest.test_close_error_on_close                                |
|     4 |     2 | AssertionError: 'non_existing_close' not found in "name 'non_existing_flush' is not defined"                      | test_io.test_bufferedio CBufferedRandomTest.test_nonnormalized_close_error_on_close                  |
|     4 |     1 | FileNotFoundError: [Errno N] No such file or directory: 'foo'                                                     | test_unittest.testmock.testwith TestMockOpen.test_explicit_mock                                      |
|     3 |     3 | AssertionError: 'N' != 'N'                                                                                        | test_builtin BuiltinTest.test_sum                                                                    |
