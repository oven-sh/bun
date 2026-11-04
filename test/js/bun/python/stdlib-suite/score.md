# The tests of CPython's standard library, translated to TypeScript: the score

- Files: 821. Test methods in them: 32270.
- Translated: 31868 (98.8%). Left out: 402.
- Tests run (a method counts once for each class that inherits it): 40849; the originals run 40954 under the same bun.
- Pass: 36978 (90.5% of those run).
- Fail: 1572. Crash: 2. Timeout: 13. Need something that was left out: 352. Need JavaScript on a second thread: 1552.
- Fail as the original does under the same bun (no matter of the translation): 780.
- Methods in files that fail to load: 66.

## Why test methods were left out

| Methods | Reason |
| ---: | --- |
| 93 | the file: the namespace of the module |
| 73 | syntax: TryStar |
| 62 | frames |
| 49 | type parameters |
| 34 | the file: syntax: TypeAlias |
| 23 | syntax: TemplateStr |
| 14 | syntax: Match |
| 13 | syntax: TypeAlias |
| 13 | __class__ as a variable |
| 9 | the namespace of the module |
| 6 | not in a test case at the top of the file |
| 5 | raise without an exception outside a handler |
| 2 | a global variable in the place of a built-in |
| 2 | yield in a lambda |
| 1 | class with **keywords |
| 1 | await outside an async function |
| 1 | syntax: del |
| 1 | super() or __class__ outside a method |
| 0 | the file: syntax error: invalid syntax |

## Failures whose cause is known

| Tests | Files | Cause | Example |
| ---: | ---: | --- | --- |
| 807 | 30 | the test is about its own code: tracing, frames, code objects, bytecode | test_annotationlib TestCallAnnotateFunction.test_error_from_value_raised |
| 81 | 4 | a test that needed JavaScript on a second thread was interrupted and left something behind | test_docxmlrpc DocXMLRPCHTTPGETServer.test_annotations |
| 40 | 14 | a whole float that a call returns is an int when it goes back | test_builtin BuiltinTest.test_round |
| 32 | 7 | a function of JavaScript cannot be pickled, copied by reference or weakly referenced | test_builtin BuiltinTest.test_filter_pickle |
| 30 | 11 | a function of JavaScript has no code object, closure, defaults, annotations, signature or __dict__ | test_builtin BuiltinTest.test_exec_closure |
| 18 | 3 | for what JavaScript calls, the loop that Bun runs is the running loop | test_asyncio.test_futures CFutureTests.test_constructor_use_global_loop |
| 14 | 3 | no exception is being handled in a `catch`: __context__, sys.exception(), traceback.format_exc() | test_asyncio.test_tasks CTaskSubclass_PyFuture_Tests.test_exception_chaining_after_await |
| 4 | 3 | what goes by the frame of the caller finds none of the test's | test_urlparse UrlParseTestCase.test_parse_qsl_false_value |
| 3 | 1 | a coroutine made of a generator is not a coroutine object of Python's | test_unittest.testmock.testasync AsyncMockAssert.test_assert_has_calls_not_awaits |
| 2 | 2 | a call of what cannot be called, and the like, is a TypeError of JavaScript's | test_descr ClassPropertiesAndMethods.test_metaclass |

## The other failures, by message

| Tests | Files | Message | Example |
| ---: | ---: | --- | --- |
| 75 | 15 | AssertionError: TypeError not raised | test_array ByteTest.test_clear |
| 38 | 1 | (the file) TypeError: __class__ must be set to a class, not 'NoneType' object | test_super  |
| 38 | 5 | AssertionError: RuntimeError not raised | test_asyncio.test_base_events BaseEventLoopTests.test_custom_run_forever_integration |
| 28 | 1 | (the file) AttributeError: 'JSFunction' object has no attribute '__code__' | test_sys_setprofile  |
| 19 | 14 | AssertionError: N != N | test_contextlib ContextManagerTestCase.test_contextmanager_traceback |
| 16 | 1 | RuntimeError: text 'await asyncio.sleep(N)' not found in: | test_asyncio.test_tasks CTaskSubclass_PyFuture_Tests.test_cancel_traceback_for_future_exception |
| 14 | 1 | AttributeError: 'NoneType' object has no attribute 'clear' | test_warnings CWarnTests.test_filename_module |
| 13 | 7 | timeout: timeout | test_exceptions ExceptionTests.testInfiniteRecursion |
| 13 | 1 | AssertionError: '…/test_gettext.test.ts' != '…/test_gettext.py' | test_gettext GNUTranslationsClassPluralFormsTestCase.test_plural_context_forms |
| 9 | 2 | IndexError: list index out of range | test_asyncio.test_pep492 CoroutineTests.test_task_print_stack |
| 8 | 1 | AssertionError: Element counts were not equal: | test_asyncio.test_tasks CTaskSubclass_PyFuture_Tests.test_as_completed_plain_iterator_cancelled_wait |
| 8 | 1 | AssertionError: 'Task was destroyed but it is pending' not found in "Task exception was never retrieved\nfuture: <Task finished name='Task-N' coro=<BaseTask | test_asyncio.test_tasks CTaskSubclass_PyFuture_Tests.test_error_in_call_soon |
| 8 | 1 | AssertionError: "<Tas[N chars]uch()> cb=[<Dummy>()]>" != "<Tas[N chars]uch() running at …/release[N chars]()]>" | test_asyncio.test_tasks CTaskSubclass_PyFuture_Tests.test_task_repr |
| 7 | 3 | AssertionError: TypeError not raised by read | test_bz2 BZ2FileTest.testRead |
| 7 | 1 | AssertionError: '…/test_re.test.ts' != '…/test_re.py' | test_re ReTests.test_basic_re_sub |
| 6 | 1 | AssertionError: Lists differ: …r()]] != [] | test_asyncio.test_futures CFutureTests.test_future_cancelled_exception_refcycles |
| 6 | 2 | AssertionError: expected call not found. | test_unittest.testmock.testhelpers SpecSignatureTest.test_autospec_functions_with_self_in_odd_place |
| 6 | 1 | FileNotFoundError: [Errno N] No such file or directory: 'bar' | test_unittest.testmock.testwith TestMockOpen.test_dunder_iter_data |
| 5 | 1 | OSError: TarFile is closed | test_tarfile Bz2WriteTest.test_filter |
| 4 | 1 | AssertionError: '…/test_argparse.test.ts' != '…/test_argparse.py' | test_argparse TestFileTypeDeprecation.test |
| 4 | 2 | AssertionError: floats N and -N are not identical: zeros have different signs | test_complex ComplexTest.test_constructor_from_string |
| 4 | 4 | AssertionError: N != -N | test_complex ComplexTest.test_constructor_negative_nans_from_string |
| 4 | 1 | TypeError: 'async for' requires an object with __aiter__ method, got coroutine | test_contextlib_async AsyncContextManagerTestCase.test_decorator_decorate_asyncgen_function |
| 4 | 3 | AssertionError: 'N' != '-N' | test_decimal PyExplicitConstructionTest.test_explicit_context_create_from_float |
| 4 | 3 | AssertionError: … != … | test_functools TestLRUC.test_get_annotations_with_forwardref |
| 4 | 2 | AssertionError: NameError not raised | test_typing NamedTupleTests.test_deferred_annotations |
| 4 | 1 | ExceptionGroup: unhandled errors in a TaskGroup (N sub-exceptions) | test_asyncio.test_free_threading TestCFreeThreading.test_run_coroutine_threadsafe |
| 4 | 1 | AssertionError: Lists differ: …[]]]] != …, [['T<anon>[N chars][]]]] | test_asyncio.test_graph TestCallStackC.test_stack_as_completed |
| 4 | 1 | AssertionError: Lists differ: …[]]]] != …, [['[N chars][]]]] | test_asyncio.test_graph TestCallStackC.test_stack_gather |
| 4 | 1 | AssertionError: Lists differ: …[]]]] != …, [[[N chars][]]]] | test_asyncio.test_graph TestCallStackC.test_stack_timeout |
| 4 | 1 | AssertionError: True is not false | test_asyncio.test_tasks CTaskSubclass_PyFuture_Tests.test_tb_logger_not_called_after_cancel |
| 4 | 1 | asyncio.exceptions.CancelledError:  | test_asyncio.test_tasks CTaskSubclass_PyFuture_Tests.test_uncancel_structured_blocks |
| 4 | 1 | FileNotFoundError: [Errno N] No such file or directory: 'foo' | test_unittest.testmock.testwith TestMockOpen.test_explicit_mock |
| 3 | 3 | AssertionError: 'N' != 'N' | test_builtin BuiltinTest.test_sum |
| 3 | 1 | ValueError: unable to get the source of <JavaScript function _fakefunc at Nx…> | test_asyncio.test_futures CFutureTests.test_future_repr |
| 3 | 1 | AssertionError: TypeError not raised by <MagicMock name='mock.one.__name__' id='N'> | test_unittest.testmock.testhelpers SpecSignatureTest.test_attributes |
| 3 | 1 | AssertionError: Calls not found. | test_unittest.testmock.testmock MockTest.test_assert_has_calls_nested_spec |
| 3 | 1 | AttributeError: Mock object has no attribute 'mock' | test_unittest.testmock.testmock MockTest.test_attach_mock_patch_autospec |
| 3 | 1 | FileNotFoundError: [Errno N] No such file or directory: 'abc' | test_unittest.testmock.testwith TestMockOpen.test_read_bytes |
| 3 | 1 | AssertionError: sentinel.Something != <MagicMock name='something' id='N'> : unpatched | test_unittest.testmock.testwith WithTest.test_with_statement_as |
