/* For here/memory_of_c.py: an object on which memory of C's hangs. */
#include <Python.h>

typedef struct {
    void *block;
} Holder;

static PyTypeObject *holder_type;
static long destroyed;

static void holder_dealloc(PyObject *self)
{
    PyTypeObject *type = Py_TYPE(self);
    Holder *holder = PyObject_GetTypeData(self, holder_type);
    PyMem_Free(holder->block);
    destroyed++;
    ((freefunc)PyType_GetSlot(type, Py_tp_free))(self);
    Py_DECREF(type);
}

static PyType_Slot holder_slots[] = {
    { Py_tp_dealloc, holder_dealloc },
    { 0, NULL },
};
static PyType_Spec holder_spec = { "memory.Holder", -(int)sizeof(Holder), 0, Py_TPFLAGS_DEFAULT, holder_slots };

PyObject *make_type(void)
{
    holder_type = (PyTypeObject *)PyType_FromSpec(&holder_spec);
    return Py_XNewRef((PyObject *)holder_type);
}

long fill(PyObject *self, long size)
{
    Holder *holder = PyObject_GetTypeData(self, holder_type);
    holder->block = PyMem_Calloc(1, size);
    return holder->block != NULL;
}

long grow(PyObject *self, long size)
{
    Holder *holder = PyObject_GetTypeData(self, holder_type);
    void *block = PyMem_Realloc(holder->block, size);
    if (block)
        holder->block = block;
    return block != NULL;
}

long count_destroyed(void) { return destroyed; }
