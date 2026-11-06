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

/* What an extension says about a type that it makes. */
typedef struct {
    int slot; /* Py_tp_dealloc and so on; 0 ends the array. */
    void *pfunc;
} PyType_Slot;

typedef struct {
    const char *name;
    int basicsize; /* Negative: so much more than the base. C does not know how large an object is. */
    int itemsize;
    unsigned int flags;
    PyType_Slot *slots;
} PyType_Spec;

typedef void (*destructor)(PyObject *);
typedef void (*freefunc)(void *);
typedef int (*inquiry)(PyObject *);
typedef int (*visitproc)(PyObject *, void *);
typedef int (*traverseproc)(PyObject *, visitproc, void *);
typedef PyObject *(*allocfunc)(PyTypeObject *, Py_ssize_t);

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

/* In a tp_traverse, whose parameters are named visit and arg. */
#define Py_VISIT(op) \
    do { \
        if (op) { \
            int py_visit_result = visit((PyObject *)(op), arg); \
            if (py_visit_result) \
                return py_visit_result; \
        } \
    } while (0)

#define PyObject_New(type, typeobj) ((type *)_PyObject_New(typeobj))
#define PyObject_GC_New(type, typeobj) ((type *)_PyObject_GC_New(typeobj))

#define Py_tp_alloc 47
#define Py_tp_base 48
#define Py_tp_bases 49
#define Py_tp_clear 51
#define Py_tp_dealloc 52
#define Py_tp_doc 56
#define Py_tp_traverse 71
#define Py_tp_free 74
#define Py_tp_finalize 80

#define Py_TPFLAGS_DEFAULT 0
#define Py_TPFLAGS_DISALLOW_INSTANTIATION (1UL << 7)
#define Py_TPFLAGS_IMMUTABLETYPE (1UL << 8)
#define Py_TPFLAGS_HEAPTYPE (1UL << 9)
#define Py_TPFLAGS_BASETYPE (1UL << 10)
#define Py_TPFLAGS_HAVE_GC (1UL << 14)

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

#include "numbers.h"

#ifdef __cplusplus
}
#endif

#endif
