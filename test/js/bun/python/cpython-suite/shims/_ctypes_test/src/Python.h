/* A stand-in for Python.h: just enough to build Modules/_ctypes/_ctypes_test.c as a plain shared library, without a C API.
 * Its objects are little records that ../_ctypes_test.py reads with ctypes. Nothing is ever freed. */
#ifndef STANDIN_PYTHON_H
#define STANDIN_PYTHON_H
#define _GNU_SOURCE 1
#include <dlfcn.h>
#include <stdarg.h>
#include <stddef.h>
#include <stdint.h>
#include <stdbool.h>
#include <limits.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>

enum { KIND_NONE, KIND_INT, KIND_UINT, KIND_STR, KIND_BYTES, KIND_LIST };
typedef struct _object {
    int kind;
    long long number;
    char *data;
    size_t size;
    struct _object **items;
} PyObject;
typedef ptrdiff_t Py_ssize_t;

static PyObject *standin_new(int kind, long long number, const char *data, size_t size)
{
    PyObject *o = calloc(1, sizeof(PyObject));
    o->kind = kind;
    o->number = number;
    o->size = size;
    if (data) {
        o->data = malloc(size + 1);
        memcpy(o->data, data, size);
        o->data[size] = 0;
    }
    return o;
}
static PyObject standin_none;
static char standin_error[256];
#define Py_None (&standin_none)
#define Py_NewRef(o) (o)
#define Py_DECREF(o) ((void)(o))
#define Py_RETURN_NONE return Py_None
#define PyLong_FromLong(v) standin_new(KIND_INT, (v), NULL, 0)
#define PyLong_FromLongLong(v) standin_new(KIND_INT, (v), NULL, 0)
#define PyLong_FromUnsignedLongLong(v) standin_new(KIND_UINT, (long long)(v), NULL, 0)
#define PyUnicode_FromString(s) standin_new(KIND_STR, 0, (s), strlen(s))
#define PyBytes_FromStringAndSize(s, n) standin_new(KIND_BYTES, 0, (s), (n))
#define PyUnicode_Check(o) ((o)->kind == KIND_STR)
#define PyUnicode_CompareWithASCIIString(o, s) strcmp((o)->data, (s))
/* One function of the library is handed a list of the interpreter's. The last list made here is the only one in use. */
static PyObject *standin_list;
#define PyList_New(n) (standin_list = standin_new(KIND_LIST, 0, NULL, 0))
static int PyList_Append(PyObject *list, PyObject *item)
{
    if (list != standin_list) {
        int (*real)(void *, void *) = (int (*)(void *, void *))dlsym(RTLD_DEFAULT, "PyList_Append");
        return real ? real(list, item) : -1;
    }
    list->items = realloc(list->items, (list->size + 1) * sizeof(PyObject *));
    list->items[list->size++] = item;
    return 0;
}
#define PyExc_ValueError 0
#define PyExc_TypeError 0
#define PyErr_SetString(type, message) snprintf(standin_error, sizeof standin_error, "%s", (message))
#define PyErr_Format(type, ...) snprintf(standin_error, sizeof standin_error, __VA_ARGS__)
#define PyArg_ParseTuple(...) 1

typedef PyObject *(*PyCFunction)(PyObject *, PyObject *);
typedef struct { const char *ml_name; PyCFunction ml_meth; int ml_flags; const char *ml_doc; } PyMethodDef;
struct PyModuleDef_Slot { int slot; void *value; };
typedef struct PyModuleDef { int head; const char *m_name; const char *m_doc; Py_ssize_t m_size; PyMethodDef *m_methods; struct PyModuleDef_Slot *m_slots; void *m_traverse, *m_clear, *m_free; } PyModuleDef;
#define PyModuleDef_HEAD_INIT 0
#define PyModuleDef_Init(def) ((PyObject *)(def)->m_methods)
#define METH_VARARGS 1
#define METH_NOARGS 4
#define METH_O 8
#define Py_mod_multiple_interpreters 3
#define Py_MOD_PER_INTERPRETER_GIL_SUPPORTED ((void *)2)
#define Py_mod_gil 4
#define Py_MOD_GIL_NOT_USED ((void *)1)
#define Py_EXPORTED_SYMBOL __attribute__((visibility("default")))
#define PyMODINIT_FUNC Py_EXPORTED_SYMBOL PyObject *
#define _Py_thread_local _Thread_local
#define _Py_FFI_SUPPORT_C_COMPLEX 1
#define HAVE_WCHAR_H 1

Py_EXPORTED_SYMBOL PyObject *standin_string(const char *s) { return PyUnicode_FromString(s); }
Py_EXPORTED_SYMBOL const char *standin_last_error(void) { return standin_error; }
#endif
