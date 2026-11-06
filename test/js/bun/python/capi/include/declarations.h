/* The functions and the data. See Python.h. Nothing but declarations, so that this can be compiled after CPython's header. */

/* References, identity, constants */
void _Py_IncRef(PyObject *);
void _Py_DecRef(PyObject *);
void Py_IncRef(PyObject *);
void Py_DecRef(PyObject *);
PyObject *Py_NewRef(PyObject *);
PyObject *Py_XNewRef(PyObject *);
Py_ssize_t Py_REFCNT(PyObject *);
PyTypeObject *Py_TYPE(PyObject *);
int Py_IS_TYPE(PyObject *, PyTypeObject *);
int Py_Is(PyObject *, PyObject *);
int Py_IsNone(PyObject *);
int Py_IsTrue(PyObject *);
int Py_IsFalse(PyObject *);
PyObject *Py_GetConstant(unsigned int);
PyObject *Py_GetConstantBorrowed(unsigned int);
int Py_IsInitialized(void);

/* The error indicator */
PyObject *PyErr_Occurred(void);
void PyErr_Clear(void);
PyObject *PyErr_GetRaisedException(void);
void PyErr_SetRaisedException(PyObject *);
void PyErr_SetObject(PyObject *, PyObject *);
void PyErr_SetNone(PyObject *);
void PyErr_SetString(PyObject *, const char *);
int PyErr_GivenExceptionMatches(PyObject *, PyObject *);
int PyErr_ExceptionMatches(PyObject *);

/* Objects */
PyObject *PyObject_Repr(PyObject *);
PyObject *PyUnicode_FromString(const char *);
PyObject *PyLong_FromLong(long);
long PyLong_AsLong(PyObject *);
PyObject *PyFloat_FromDouble(double);
double PyFloat_AsDouble(PyObject *);
PyObject *PyTuple_New(Py_ssize_t);
Py_ssize_t PyTuple_Size(PyObject *);
PyObject *PyTuple_GetItem(PyObject *, Py_ssize_t);
int PyTuple_SetItem(PyObject *, Py_ssize_t, PyObject *);
PyObject *PyList_New(Py_ssize_t);
Py_ssize_t PyList_Size(PyObject *);
PyObject *PyList_GetItem(PyObject *, Py_ssize_t);
int PyList_SetItem(PyObject *, Py_ssize_t, PyObject *);
int PyList_Append(PyObject *, PyObject *);

/* Built-in types */
extern PyTypeObject PyBaseObject_Type, PyBool_Type, PyByteArrayIter_Type, PyByteArray_Type, PyBytesIter_Type, PyBytes_Type, PyCFunction_Type,
    PyCallIter_Type, PyClassMethodDescr_Type, PyComplex_Type, PyDictItems_Type, PyDictIterItem_Type, PyDictIterKey_Type, PyDictIterValue_Type,
    PyDictKeys_Type, PyDictProxy_Type, PyDictRevIterItem_Type, PyDictRevIterKey_Type, PyDictRevIterValue_Type, PyDictValues_Type, PyDict_Type,
    PyEllipsis_Type, PyEnum_Type, PyFilter_Type, PyFloat_Type, PyFrozenSet_Type, PyGetSetDescr_Type, PyListIter_Type, PyListRevIter_Type,
    PyList_Type, PyLongRangeIter_Type, PyLong_Type, PyMap_Type, PyMemberDescr_Type, PyMemoryView_Type, PyMethodDescr_Type, PyModule_Type,
    PyProperty_Type, PyRangeIter_Type, PyRange_Type, PyReversed_Type, PySeqIter_Type, PySetIter_Type, PySet_Type, PySlice_Type, PySuper_Type,
    PyTraceBack_Type, PyTupleIter_Type, PyTuple_Type, PyType_Type, PyUnicodeIter_Type, PyUnicode_Type, PyWrapperDescr_Type, PyZip_Type,
    Py_GenericAliasType, _PyWeakref_CallableProxyType, _PyWeakref_ProxyType, _PyWeakref_RefType;

/* Exceptions */
extern PyObject *PyExc_ArithmeticError, *PyExc_AssertionError, *PyExc_AttributeError, *PyExc_BaseException, *PyExc_BaseExceptionGroup,
    *PyExc_BlockingIOError, *PyExc_BrokenPipeError, *PyExc_BufferError, *PyExc_BytesWarning, *PyExc_ChildProcessError,
    *PyExc_ConnectionAbortedError, *PyExc_ConnectionError, *PyExc_ConnectionRefusedError, *PyExc_ConnectionResetError,
    *PyExc_DeprecationWarning, *PyExc_EOFError, *PyExc_EncodingWarning, *PyExc_EnvironmentError, *PyExc_Exception, *PyExc_FileExistsError,
    *PyExc_FileNotFoundError, *PyExc_FloatingPointError, *PyExc_FutureWarning, *PyExc_GeneratorExit, *PyExc_IOError, *PyExc_ImportError,
    *PyExc_ImportWarning, *PyExc_IndentationError, *PyExc_IndexError, *PyExc_InterruptedError, *PyExc_IsADirectoryError, *PyExc_KeyError,
    *PyExc_KeyboardInterrupt, *PyExc_LookupError, *PyExc_MemoryError, *PyExc_ModuleNotFoundError, *PyExc_NameError,
    *PyExc_NotADirectoryError, *PyExc_NotImplementedError, *PyExc_OSError, *PyExc_OverflowError, *PyExc_PendingDeprecationWarning,
    *PyExc_PermissionError, *PyExc_ProcessLookupError, *PyExc_RecursionError, *PyExc_ReferenceError, *PyExc_ResourceWarning,
    *PyExc_RuntimeError, *PyExc_RuntimeWarning, *PyExc_StopAsyncIteration, *PyExc_StopIteration, *PyExc_SyntaxError, *PyExc_SyntaxWarning,
    *PyExc_SystemError, *PyExc_SystemExit, *PyExc_TabError, *PyExc_TimeoutError, *PyExc_TypeError, *PyExc_UnboundLocalError,
    *PyExc_UnicodeDecodeError, *PyExc_UnicodeEncodeError, *PyExc_UnicodeError, *PyExc_UnicodeTranslateError, *PyExc_UnicodeWarning,
    *PyExc_UserWarning, *PyExc_ValueError, *PyExc_Warning, *PyExc_ZeroDivisionError;

/* Memory */
void *PyMem_Malloc(size_t);
void *PyMem_Calloc(size_t, size_t);
void *PyMem_Realloc(void *, size_t);
void PyMem_Free(void *);
void *PyMem_RawMalloc(size_t);
void *PyMem_RawCalloc(size_t, size_t);
void *PyMem_RawRealloc(void *, size_t);
void PyMem_RawFree(void *);
void *PyObject_Malloc(size_t);
void *PyObject_Calloc(size_t, size_t);
void *PyObject_Realloc(void *, size_t);
void PyObject_Free(void *);

/* Types that extensions make, and the life of their instances */
PyObject *PyType_FromSpec(PyType_Spec *);
PyObject *PyType_FromSpecWithBases(PyType_Spec *, PyObject *);
PyObject *PyType_FromModuleAndSpec(PyObject *, PyType_Spec *, PyObject *);
PyObject *PyType_FromMetaclass(PyTypeObject *, PyObject *, PyType_Spec *, PyObject *);
int PyType_IsSubtype(PyTypeObject *, PyTypeObject *);
void *PyType_GetSlot(PyTypeObject *, int);
Py_ssize_t PyType_GetTypeDataSize(PyTypeObject *);
PyObject *PyType_GenericAlloc(PyTypeObject *, Py_ssize_t);
PyObject *_PyObject_New(PyTypeObject *);
PyObject *_PyObject_GC_New(PyTypeObject *);
void *PyObject_GetTypeData(PyObject *, PyTypeObject *);
void *PyObject_GetTypeData_DuringGC(PyObject *, PyTypeObject *);
void PyObject_GC_Track(void *);
void PyObject_GC_UnTrack(void *);
void PyObject_GC_Del(void *);
int PyObject_GC_IsTracked(PyObject *);
int PyObject_GC_IsFinalized(PyObject *);
int PyObject_CallFinalizerFromDealloc(PyObject *);
void PyObject_ClearWeakRefs(PyObject *);
