/* Loaded with ctypes.PyDLL by ownership.py: who owns a reference where ctypes and C meet, and what C may conclude from a count or an address. */
#include <Python.h>
#include <stdlib.h>

int is_int_type(PyObject *object) { return object == (PyObject *)&PyLong_Type; }
long count(PyObject *object) { return (long)Py_REFCNT(object); }

static PyObject *held;
void hold(PyObject *object) { held = Py_NewRef(object); }
PyObject *peek(void) { return Py_NewRef(held); }
void drop(void) { Py_CLEAR(held); }
void give_back(PyObject *object) { Py_DECREF(object); }
void own_the_empty_bytes(void) { held = Py_GetConstant(Py_CONSTANT_EMPTY_BYTES); }

/* What a callback returns is C's. It is kept where no collector looks. */
typedef PyObject *(*makes)(void);
static PyObject **kept;
void keep_result_of(makes make)
{
    kept = malloc(sizeof *kept);
    *kept = make();
}
PyObject *give_kept(void)
{
    PyObject *result = *kept;
    free(kept);
    kept = NULL;
    return result;
}

/* Tuples: C fills what it has made and nobody else has. */
int set_item(PyObject *tuple, long index, PyObject *item) { return PyTuple_SetItem(tuple, index, Py_NewRef(item)); }

typedef void (*looks)(PyObject *);
PyObject *tuple_changed_after_a_look(looks look, PyObject *first, PyObject *second)
{
    PyObject *tuple = PyTuple_New(1);
    if (!tuple || PyTuple_SetItem(tuple, 0, Py_NewRef(first)))
        return NULL;
    look(tuple);
    if (PyTuple_SetItem(tuple, 0, Py_NewRef(second))) {
        Py_DECREF(tuple);
        return NULL;
    }
    return tuple;
}

/* -1 and a SystemError: two references are not one. */
int set_item_of_a_tuple_owned_twice(PyObject *item)
{
    PyObject *tuple = PyTuple_New(1);
    Py_INCREF(tuple);
    int status = PyTuple_SetItem(tuple, 0, Py_NewRef(item));
    Py_DECREF(tuple);
    Py_DECREF(tuple);
    return status;
}

PyObject *list_of_floats(long n)
{
    PyObject *list = PyList_New(n);
    for (long i = 0; list && i < n; i++)
        PyList_SetItem(list, i, PyFloat_FromDouble(i + 0.5));
    return list;
}

void raise_object(PyObject *type, PyObject *value) { PyErr_SetObject(type, value); }
void raise_string(PyObject *type, const char *message) { PyErr_SetString(type, message); }
void raise_none(PyObject *type) { PyErr_SetNone(type); }
/* Both at once. */
PyObject *raise_and_return(PyObject *type, PyObject *object)
{
    PyErr_SetNone(type);
    return Py_NewRef(object);
}
