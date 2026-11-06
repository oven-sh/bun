/* Loaded with ctypes.PyDLL by identity.py: where C finds the built-in types. */
#include <Python.h>

#define EACH(v) \
    v(PyBaseObject_Type) v(PyBool_Type) v(PyByteArray_Type) v(PyBytes_Type) v(PyComplex_Type) v(PyDict_Type) v(PyEnum_Type) v(PyFilter_Type) v(PyFloat_Type) \
    v(PyFrozenSet_Type) v(PyList_Type) v(PyLong_Type) v(PyMap_Type) v(PyMemoryView_Type) v(PyProperty_Type) v(PyRange_Type) v(PyReversed_Type) v(PySet_Type) \
    v(PySlice_Type) v(PySuper_Type) v(PyTuple_Type) v(PyType_Type) v(PyUnicode_Type) v(PyZip_Type)

/* The addresses, as ints, in that order. */
PyObject *addresses(void)
{
    PyObject *result = PyList_New(0);
#define ADD(type) \
    { \
        PyObject *item = PyLong_FromLong((long)(intptr_t)&type); \
        PyList_Append(result, item); \
        Py_DECREF(item); \
    }
    EACH(ADD)
    return result;
}

/* And the types. */
PyObject *types(void)
{
    PyObject *result = PyList_New(0);
#define APPEND(type) PyList_Append(result, (PyObject *)&type);
    EACH(APPEND)
    return result;
}

unsigned long address_of(PyObject *object) { return (unsigned long)(uintptr_t)object; }
