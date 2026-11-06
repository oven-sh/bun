/*
 * What the extensions in this directory are compiled with when Bun's tests run: the part of Python's C API for abi3t (PEP 803) that Bun
 * implements so far. Written for these tests. It is not CPython's header and holds none of its text; tools/check_header.py compiles
 * declarations.h after CPython's own Python.h, so a declaration that differs from CPython's is an error there.
 *
 * In abi3t C sees the layout of no object: PyObject and PyTypeObject are incomplete types, and whatever is done to an object is a call.
 */
#ifndef Py_PYTHON_H
#define Py_PYTHON_H

#include <stddef.h>
#include <stdint.h>
#include <sys/types.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef ssize_t Py_ssize_t;
typedef struct _object PyObject;
typedef struct _typeobject PyTypeObject;

#include "declarations.h"

#define Py_INCREF(op) _Py_IncRef((PyObject *)(op))
#define Py_DECREF(op) _Py_DecRef((PyObject *)(op))
#define Py_XINCREF(op) Py_IncRef((PyObject *)(op))
#define Py_XDECREF(op) Py_DecRef((PyObject *)(op))
#define Py_CLEAR(op) \
    do { \
        PyObject *py_clear_old = (PyObject *)(op); \
        (op) = NULL; \
        Py_DecRef(py_clear_old); \
    } while (0)

#define Py_CONSTANT_NONE 0
#define Py_CONSTANT_FALSE 1
#define Py_CONSTANT_TRUE 2
#define Py_CONSTANT_ELLIPSIS 3
#define Py_CONSTANT_NOT_IMPLEMENTED 4
#define Py_CONSTANT_ZERO 5
#define Py_CONSTANT_ONE 6
#define Py_CONSTANT_EMPTY_STR 7
#define Py_CONSTANT_EMPTY_BYTES 8
#define Py_CONSTANT_EMPTY_TUPLE 9

#define Py_None Py_GetConstantBorrowed(Py_CONSTANT_NONE)
#define Py_False Py_GetConstantBorrowed(Py_CONSTANT_FALSE)
#define Py_True Py_GetConstantBorrowed(Py_CONSTANT_TRUE)
#define Py_Ellipsis Py_GetConstantBorrowed(Py_CONSTANT_ELLIPSIS)
#define Py_NotImplemented Py_GetConstantBorrowed(Py_CONSTANT_NOT_IMPLEMENTED)
#define Py_RETURN_NONE return Py_None
#define Py_RETURN_TRUE return Py_True
#define Py_RETURN_FALSE return Py_False

#ifdef __cplusplus
}
#endif

#endif
