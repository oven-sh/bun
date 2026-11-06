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

/* C gives a tuple away, and keeps a reference of its own. */
static PyObject *kept_tuple;
PyObject *make_tuple_and_keep_it(PyObject *item)
{
    PyObject *tuple = PyTuple_New(1);
    if (!tuple || PyTuple_SetItem(tuple, 0, Py_NewRef(item)))
        return NULL;
    kept_tuple = Py_NewRef(tuple);
    return tuple;
}
PyObject *put_tuple_into_list_and_keep_it(PyObject *item)
{
    PyObject *list = PyList_New(1);
    PyObject *tuple = PyTuple_New(1);
    if (!list || !tuple || PyTuple_SetItem(tuple, 0, Py_NewRef(item)))
        return NULL;
    kept_tuple = Py_NewRef(tuple);
    PyList_SetItem(list, 0, tuple);
    return list;
}
PyObject *put_tuple_into_tuple_and_keep_it(PyObject *item)
{
    PyObject *outer = PyTuple_New(1);
    PyObject *tuple = PyTuple_New(1);
    if (!outer || !tuple || PyTuple_SetItem(tuple, 0, Py_NewRef(item)))
        return NULL;
    kept_tuple = Py_NewRef(tuple);
    PyTuple_SetItem(outer, 0, tuple);
    return outer;
}
int set_item_of_kept_tuple(PyObject *item) { return PyTuple_SetItem(kept_tuple, 0, Py_NewRef(item)); }
void give_back_kept_tuple(void) { Py_CLEAR(kept_tuple); }

/* What C raises the program gets, whatever it is. */
void raise_tuple_and_keep_it(PyObject *item)
{
    kept_tuple = PyTuple_New(1);
    PyTuple_SetItem(kept_tuple, 0, Py_NewRef(item));
    PyErr_SetRaisedException(Py_NewRef(kept_tuple));
}

/* "Put it in, then fill it": from then on one Py_DECREF of the container frees all. The one reference is the container's. */
PyObject *fill_tuple_that_a_tuple_has_taken_over(PyObject *item)
{
    PyObject *outer = PyTuple_New(1), *inner = PyTuple_New(1);
    if (!outer || !inner || PyTuple_SetItem(outer, 0, inner))
        return NULL;
    if (PyTuple_SetItem(inner, 0, Py_NewRef(item))) {
        Py_DECREF(outer);
        return NULL;
    }
    return outer;
}
PyObject *fill_tuples_that_a_list_has_taken_over(long n)
{
    PyObject *list = PyList_New(n);
    for (long i = 0; list && i < n; i++) {
        PyObject *pair = PyTuple_New(2);
        if (!pair || PyList_SetItem(list, i, pair) || PyTuple_SetItem(pair, 0, PyLong_FromLong(i)) || PyTuple_SetItem(pair, 1, PyLong_FromLong(i * i)))
            Py_CLEAR(list);
    }
    return list;
}
/* The list takes a reference of its own. While C has its own too, there are two. */
PyObject *fill_tuple_that_was_appended(PyObject *item, int gives_its_reference_back_first)
{
    PyObject *list = PyList_New(0), *tuple = PyTuple_New(1);
    if (!list || !tuple || PyList_Append(list, tuple))
        return NULL;
    if (gives_its_reference_back_first)
        Py_DECREF(tuple);
    int status = PyTuple_SetItem(tuple, 0, Py_NewRef(item));
    if (!gives_its_reference_back_first)
        Py_DECREF(tuple);
    if (status)
        Py_CLEAR(list);
    return list;
}
/* In two containers there are two. */
PyObject *fill_tuple_that_two_lists_have(PyObject *item)
{
    PyObject *lists = PyTuple_New(2), *tuple = PyTuple_New(1);
    PyTuple_SetItem(lists, 0, PyList_New(0));
    PyTuple_SetItem(lists, 1, PyList_New(0));
    PyList_Append(PyTuple_GetItem(lists, 0), tuple);
    PyList_Append(PyTuple_GetItem(lists, 1), tuple);
    Py_DECREF(tuple);
    if (PyTuple_SetItem(tuple, 0, Py_NewRef(item)))
        Py_CLEAR(lists);
    return lists;
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
void raise_instance(PyObject *exception) { PyErr_SetRaisedException(Py_NewRef(exception)); }
/* Both at once. */
PyObject *raise_and_return(PyObject *type, PyObject *object)
{
    PyErr_SetNone(type);
    return Py_NewRef(object);
}
/* A new tuple, of which C keeps a second reference. Nobody gets it, so C may go on filling it. */
static PyObject *tuple_returned_beside_an_exception;
PyObject *raise_and_return_new_tuple(PyObject *type)
{
    tuple_returned_beside_an_exception = PyTuple_New(1);
    PyErr_SetNone(type);
    return Py_NewRef(tuple_returned_beside_an_exception);
}
PyObject *fill_tuple_returned_beside_an_exception(PyObject *item)
{
    if (PyTuple_SetItem(tuple_returned_beside_an_exception, 0, Py_NewRef(item)))
        return NULL;
    return tuple_returned_beside_an_exception;
}
/* The same where the value of the call is that of an out parameter. */
PyObject *return_new_tuple_and_an_out_parameter(long *out)
{
    *out = 5;
    tuple_returned_beside_an_exception = PyTuple_New(1);
    return Py_NewRef(tuple_returned_beside_an_exception);
}
/* Wrong C (in CPython, a use after free): it gives back the only reference there is, returns the tuple all the same, and takes a reference again. The program has got the tuple. */
static PyObject *tuple_given_back_and_returned;
PyObject *give_back_and_return_new_tuple(void)
{
    tuple_given_back_and_returned = PyTuple_New(1);
    PyTuple_SetItem(tuple_given_back_and_returned, 0, PyLong_FromLong(1));
    Py_DECREF(tuple_given_back_and_returned);
    return tuple_given_back_and_returned;
}
int change_tuple_given_back_and_returned(void)
{
    Py_INCREF(tuple_given_back_and_returned);
    int status = PyTuple_SetItem(tuple_given_back_and_returned, 0, PyLong_FromLong(2));
    PyErr_Clear();
    return status;
}
/* What is returned beside an exception nobody looks at. */
PyObject *raise_and_return_what_is_no_object(PyObject *type)
{
    PyErr_SetNone(type);
    return (PyObject *)0x10;
}
