/* Loaded with ctypes.PyDLL by loaded.py: a library that reads the data of the API and calls it while it is being loaded. */
#include <Python.h>

/* No abi3t header names it: Py_None is a call. It is in the stable ABI all the same. */
extern PyObject _Py_NoneStruct;

static int was_initialized;
static PyObject *error, *none, *list, *number;
static int two_types_are_one, a_type_is_itself, is_none, none_is_none, none_is_true;

__attribute__((constructor)) static void load(void)
{
    /* Before the first call of all. */
    error = PyExc_ValueError;
    Py_INCREF(error);
    two_types_are_one = Py_Is((PyObject *)&PyLong_Type, (PyObject *)&PyFloat_Type);
    a_type_is_itself = Py_Is((PyObject *)&PyLong_Type, (PyObject *)&PyLong_Type);
    is_none = Py_IsNone(&_Py_NoneStruct);
    none_is_none = Py_Is(&_Py_NoneStruct, Py_None);
    none_is_true = Py_IsTrue(&_Py_NoneStruct);
    was_initialized = Py_IsInitialized();
    none = Py_None;
    list = PyList_New(0);
    number = PyLong_FromLong(1L << 62);
    PyList_Append(list, number);
}

int initialized_then(void) { return was_initialized; }
int is_the_none_of_then(PyObject *object) { return object == none; }
PyObject *list_of_then(void) { return Py_NewRef(list); }
int is_int_type(PyObject *object) { return object == (PyObject *)&PyLong_Type; }
PyObject *type_of_the_number(void) { return Py_NewRef((PyObject *)Py_TYPE(number)); }
PyObject *error_of_then(void) { return Py_XNewRef(error); }
void raise_the_error_of_then(void) { PyErr_SetString(error, "with what was read as the library was loaded"); }
/* For who cannot be handed an object. */
int identities_then_as_bits(void) { return two_types_are_one | a_type_is_itself << 1 | is_none << 2 | none_is_none << 3 | none_is_true << 4; }
PyObject *identities_then(void)
{
    PyObject *result = PyList_New(0);
    int all[] = { two_types_are_one, a_type_is_itself, is_none, none_is_none, none_is_true };
    for (size_t i = 0; i < sizeof all / sizeof *all; i++) {
        PyObject *item = PyLong_FromLong(all[i]);
        PyList_Append(result, item);
        Py_DECREF(item);
    }
    return result;
}
