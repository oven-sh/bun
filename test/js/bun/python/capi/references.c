/* Loaded with ctypes.PyDLL by references.py: references, identity, constants and the error indicator, before there are modules. */
#include <Python.h>
#include <string.h>

#define SLOTS 4096
static PyObject *slots[SLOTS];

/* ---- References that C owns ---- */

long hold(PyObject *object)
{
    for (long i = 0; i < SLOTS; i++) {
        if (!slots[i]) {
            slots[i] = Py_NewRef(object);
            return i;
        }
    }
    return -1;
}

PyObject *held(long i) { return Py_NewRef(slots[i]); }

void drop(long i) { Py_CLEAR(slots[i]); }

long count_held(void)
{
    long n = 0;
    for (long i = 0; i < SLOTS; i++)
        n += slots[i] != NULL;
    return n;
}

/* Objects that nothing but C refers to. */
long make_and_hold(long n)
{
    PyObject *list = PyList_New(0);
    if (!list)
        return -1;
    for (long i = 0; i < n; i++) {
        PyObject *pair = PyTuple_New(3);
        if (!pair)
            return -1;
        char text[32] = "item ";
        char *end = text + 5;
        long v = i;
        char digits[24];
        int k = 0;
        do { digits[k++] = (char)('0' + v % 10); v /= 10; } while (v);
        while (k) *end++ = digits[--k];
        *end = 0;
        PyTuple_SetItem(pair, 0, PyLong_FromLong(i * 1000003L * 1000003L));
        PyTuple_SetItem(pair, 1, PyUnicode_FromString(text));
        PyTuple_SetItem(pair, 2, PyFloat_FromDouble((double)i));
        if (PyList_Append(list, pair) < 0)
            return -1;
        Py_DECREF(pair);
    }
    long where = hold(list);
    Py_DECREF(list);
    return where;
}

/* How much the count changes, which is all that can be said about it. */
long count_after_incref(PyObject *object)
{
    Py_ssize_t before = Py_REFCNT(object);
    Py_INCREF(object);
    Py_ssize_t after = Py_REFCNT(object);
    Py_DECREF(object);
    return (long)(after - before) * 10 + (long)(Py_REFCNT(object) - before);
}

void incref_many(PyObject *object, long n) { while (n--) Py_INCREF(object); }
void decref_many(PyObject *object, long n) { while (n--) Py_DECREF(object); }

/* ---- Identity ---- */

int same(PyObject *a, PyObject *b) { return a == b; }
int same_by_call(PyObject *a, PyObject *b) { return Py_Is(a, b); }
PyObject *identity(PyObject *object) { return Py_NewRef(object); }

int which_constant(PyObject *object)
{
    for (unsigned i = 0; i <= Py_CONSTANT_EMPTY_TUPLE; i++) {
        if (object == Py_GetConstantBorrowed(i))
            return (int)i;
    }
    return -1;
}

PyObject *constant(unsigned i) { return Py_GetConstant(i); }

int tests_of_constants(PyObject *object)
{
    return Py_IsNone(object) | Py_IsTrue(object) << 1 | Py_IsFalse(object) << 2 | (object == Py_None) << 3 | (object == Py_True) << 4 | (object == Py_False) << 5
        | (object == Py_Ellipsis) << 6 | (object == Py_NotImplemented) << 7;
}

/* ---- Types ---- */

PyObject *type_of(PyObject *object) { return Py_NewRef((PyObject *)Py_TYPE(object)); }

static struct { const char *name; PyTypeObject *type; } types[] = {
    { "object", &PyBaseObject_Type }, { "bool", &PyBool_Type }, { "bytearray", &PyByteArray_Type }, { "bytes", &PyBytes_Type },
    { "builtin_function_or_method", &PyCFunction_Type }, { "complex", &PyComplex_Type }, { "dict", &PyDict_Type }, { "ellipsis", &PyEllipsis_Type },
    { "enumerate", &PyEnum_Type }, { "filter", &PyFilter_Type }, { "float", &PyFloat_Type }, { "frozenset", &PyFrozenSet_Type }, { "list", &PyList_Type },
    { "int", &PyLong_Type }, { "map", &PyMap_Type }, { "memoryview", &PyMemoryView_Type }, { "module", &PyModule_Type }, { "property", &PyProperty_Type },
    { "range", &PyRange_Type }, { "reversed", &PyReversed_Type }, { "set", &PySet_Type }, { "slice", &PySlice_Type }, { "super", &PySuper_Type },
    { "traceback", &PyTraceBack_Type }, { "tuple", &PyTuple_Type }, { "type", &PyType_Type }, { "str", &PyUnicode_Type }, { "zip", &PyZip_Type },
    { "mappingproxy", &PyDictProxy_Type }, { "dict_keys", &PyDictKeys_Type }, { "dict_values", &PyDictValues_Type }, { "dict_items", &PyDictItems_Type },
    { "dict_keyiterator", &PyDictIterKey_Type }, { "dict_valueiterator", &PyDictIterValue_Type }, { "dict_itemiterator", &PyDictIterItem_Type },
    { "dict_reversekeyiterator", &PyDictRevIterKey_Type }, { "dict_reversevalueiterator", &PyDictRevIterValue_Type },
    { "dict_reverseitemiterator", &PyDictRevIterItem_Type }, { "list_iterator", &PyListIter_Type }, { "list_reverseiterator", &PyListRevIter_Type },
    { "tuple_iterator", &PyTupleIter_Type }, { "str_ascii_iterator or str_iterator", &PyUnicodeIter_Type }, { "bytes_iterator", &PyBytesIter_Type },
    { "bytearray_iterator", &PyByteArrayIter_Type }, { "range_iterator", &PyRangeIter_Type }, { "longrange_iterator", &PyLongRangeIter_Type },
    { "set_iterator", &PySetIter_Type }, { "iterator", &PySeqIter_Type }, { "callable_iterator", &PyCallIter_Type },
    { "method_descriptor", &PyMethodDescr_Type }, { "classmethod_descriptor", &PyClassMethodDescr_Type }, { "wrapper_descriptor", &PyWrapperDescr_Type },
    { "getset_descriptor", &PyGetSetDescr_Type }, { "member_descriptor", &PyMemberDescr_Type }, { "GenericAlias", &Py_GenericAliasType },
    { "ReferenceType", &_PyWeakref_RefType }, { "ProxyType", &_PyWeakref_ProxyType }, { "CallableProxyType", &_PyWeakref_CallableProxyType },
};
#define TYPES ((long)(sizeof types / sizeof *types))

long number_of_types(void) { return TYPES; }
const char *name_of_type(long i) { return types[i].name; }
PyObject *type_by_symbol(long i) { return Py_NewRef((PyObject *)types[i].type); }

/* The place in the table of the type of the object, by the address of the symbol; of the object itself, if that is a type. */
long type_known_by_symbol(PyObject *object)
{
    for (long i = 0; i < TYPES; i++) {
        if (Py_TYPE(object) == types[i].type)
            return i;
    }
    return -1;
}

long is_symbol(PyObject *object)
{
    for (long i = 0; i < TYPES; i++) {
        if (object == (PyObject *)types[i].type)
            return i;
    }
    return -1;
}

int is_type(PyObject *object, PyObject *type) { return Py_IS_TYPE(object, (PyTypeObject *)type); }

/* A type that comes out of a container is the same pointer as the symbol. */
int first_item_is_int_type(PyObject *sequence, int is_list)
{
    PyObject *item = is_list ? PyList_GetItem(sequence, 0) : PyTuple_GetItem(sequence, 0);
    return item == (PyObject *)&PyLong_Type;
}

/* ---- References that are lent, and references that are handed over ---- */

PyObject *list_item(PyObject *list, long i) { return Py_XNewRef(PyList_GetItem(list, i)); }
PyObject *tuple_item(PyObject *tuple, long i) { return Py_XNewRef(PyTuple_GetItem(tuple, i)); }
long list_size(PyObject *list) { return (long)PyList_Size(list); }
long tuple_size(PyObject *tuple) { return (long)PyTuple_Size(tuple); }

PyObject *pair_of(PyObject *a, PyObject *b)
{
    PyObject *pair = PyTuple_New(2);
    if (!pair)
        return NULL;
    PyTuple_SetItem(pair, 0, Py_NewRef(a));
    PyTuple_SetItem(pair, 1, Py_NewRef(b));
    return pair;
}

PyObject *list_of(PyObject *a, PyObject *b)
{
    PyObject *list = PyList_New(2);
    if (!list)
        return NULL;
    PyList_SetItem(list, 0, Py_NewRef(a));
    PyList_SetItem(list, 1, Py_NewRef(b));
    return list;
}

int set_list_item(PyObject *list, long i, PyObject *item) { return PyList_SetItem(list, i, Py_NewRef(item)); }
int set_tuple_item(PyObject *tuple, long i, PyObject *item) { return PyTuple_SetItem(tuple, i, Py_NewRef(item)); }

/* ---- Numbers ---- */

PyObject *long_from(long value) { return PyLong_FromLong(value); }
long long_of(PyObject *object) { return PyLong_AsLong(object); }
PyObject *float_from(double value) { return PyFloat_FromDouble(value); }
double float_of(PyObject *object) { return PyFloat_AsDouble(object); }
PyObject *repr_of(PyObject *object) { return PyObject_Repr(object); }
PyObject *repr_of_null(void) { return PyObject_Repr(NULL); }
PyObject *str_from(const char *text) { return PyUnicode_FromString(text); }

/* ---- The error indicator ---- */

PyObject *raise_string(PyObject *type, const char *message)
{
    PyErr_SetString(type, message);
    return NULL;
}

PyObject *raise_object(PyObject *type, PyObject *value)
{
    PyErr_SetObject(type, value);
    return NULL;
}

PyObject *raise_none(PyObject *type)
{
    PyErr_SetNone(type);
    return NULL;
}

PyObject *raise_by_symbol(int which)
{
    PyObject *type = which == 0 ? PyExc_ValueError : which == 1 ? PyExc_KeyError : which == 2 ? PyExc_OSError : which == 3 ? PyExc_IOError
        : which == 4 ? PyExc_EnvironmentError : which == 5 ? PyExc_StopIteration : PyExc_UnicodeWarning;
    PyErr_SetString(type, "by symbol");
    return NULL;
}

/* An int result, and an exception all the same. */
int raise_with_int_result(void)
{
    PyErr_SetString(PyExc_RuntimeError, "the result was 7");
    return 7;
}

PyObject *null_without_exception(void) { return NULL; }

/* What C sees of an exception that it has set itself. */
PyObject *set_look_and_clear(PyObject *type, PyObject *value, PyObject *expected)
{
    PyObject *result = PyList_New(0);
    PyObject *item;
    PyList_Append(result, PyErr_Occurred() ? Py_True : Py_False);
    PyErr_SetObject(type, value);
    PyList_Append(result, PyErr_Occurred() ? PyErr_Occurred() : Py_None);
    PyList_Append(result, PyErr_ExceptionMatches(expected) ? Py_True : Py_False);
    /* The API goes on working while an exception is set. */
    item = PyLong_FromLong(1L << 62);
    PyList_Append(result, item);
    Py_DECREF(item);
    item = PyErr_GetRaisedException();
    PyList_Append(result, PyErr_Occurred() ? Py_True : Py_False);
    PyList_Append(result, item);
    PyErr_SetRaisedException(item);
    PyList_Append(result, PyErr_Occurred() ? Py_True : Py_False);
    PyErr_Clear();
    PyList_Append(result, PyErr_Occurred() ? Py_True : Py_False);
    return result;
}

/* The second takes the place of the first. */
PyObject *raise_twice(void)
{
    PyErr_SetString(PyExc_ValueError, "first");
    PyErr_SetString(PyExc_TypeError, "second");
    return NULL;
}

/* A function of the API fails: what it raised is what C finds. */
PyObject *failure_of_the_api(PyObject *list)
{
    PyObject *item = PyList_GetItem(list, 1000);
    if (item)
        return Py_NewRef(item);
    PyObject *exception = PyErr_GetRaisedException();
    return exception;
}

int matches(PyObject *given, PyObject *expected) { return PyErr_GivenExceptionMatches(given, expected); }

/* An exception that C keeps, with all that hangs off it. */
long hold_raised(PyObject *type, PyObject *value)
{
    PyErr_SetObject(type, value);
    PyObject *exception = PyErr_GetRaisedException();
    long where = hold(exception);
    Py_DECREF(exception);
    return where;
}
