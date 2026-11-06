/* The numbers and the layouts that are part of the ABI, as assertions: true of Python.h beside this file, and, says tools/check_header.py, of CPython's. */
#ifndef __cplusplus
#include <stddef.h>

_Static_assert(sizeof(PyType_Slot) == 16 && offsetof(PyType_Slot, slot) == 0 && offsetof(PyType_Slot, pfunc) == 8, "PyType_Slot");
_Static_assert(sizeof(PyType_Spec) == 32 && offsetof(PyType_Spec, name) == 0 && offsetof(PyType_Spec, basicsize) == 8 && offsetof(PyType_Spec, itemsize) == 12
    && offsetof(PyType_Spec, flags) == 16 && offsetof(PyType_Spec, slots) == 24, "PyType_Spec");

_Static_assert(Py_tp_alloc == 47 && Py_tp_base == 48 && Py_tp_bases == 49 && Py_tp_clear == 51 && Py_tp_dealloc == 52 && Py_tp_doc == 56 && Py_tp_traverse == 71
    && Py_tp_free == 74 && Py_tp_finalize == 80, "slots");

_Static_assert(Py_TPFLAGS_DEFAULT == 0 && Py_TPFLAGS_DISALLOW_INSTANTIATION == 1UL << 7 && Py_TPFLAGS_IMMUTABLETYPE == 1UL << 8 && Py_TPFLAGS_HEAPTYPE == 1UL << 9
    && Py_TPFLAGS_BASETYPE == 1UL << 10 && Py_TPFLAGS_HAVE_GC == 1UL << 14, "flags of types");

_Static_assert(Py_CONSTANT_NONE == 0 && Py_CONSTANT_FALSE == 1 && Py_CONSTANT_TRUE == 2 && Py_CONSTANT_ELLIPSIS == 3 && Py_CONSTANT_NOT_IMPLEMENTED == 4
    && Py_CONSTANT_ZERO == 5 && Py_CONSTANT_ONE == 6 && Py_CONSTANT_EMPTY_STR == 7 && Py_CONSTANT_EMPTY_BYTES == 8 && Py_CONSTANT_EMPTY_TUPLE == 9, "constants");
#endif
