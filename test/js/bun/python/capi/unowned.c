/* A type to which C keeps no reference of its own: the program has it, and its instances have. So it can die, and the realm that it is of. */
#include <Python.h>

typedef struct {
    PyObject *held;
} Data;

static int ended;
int number_ended(void) { return ended; }

static int traverse(PyObject *self, visitproc visit, void *arg)
{
    PyTypeObject *type = Py_TYPE(self);
    Py_VISIT(type);
    Py_VISIT(((Data *)PyObject_GetTypeData_DuringGC(self, type))->held);
    return 0;
}

static int clear(PyObject *self)
{
    Py_CLEAR(((Data *)PyObject_GetTypeData(self, Py_TYPE(self)))->held);
    return 0;
}

static void dealloc(PyObject *self)
{
    PyTypeObject *type = Py_TYPE(self);
    PyObject_GC_UnTrack(self);
    ended++;
    clear(self);
    ((freefunc)PyType_GetSlot(type, Py_tp_free))(self);
    Py_DECREF(type);
}

PyObject *make_type(void)
{
    static PyType_Slot slots[] = { { Py_tp_traverse, traverse }, { Py_tp_clear, clear }, { Py_tp_dealloc, dealloc }, { 0, NULL } };
    static PyType_Spec spec = { "unowned.Holder", -(int)sizeof(Data), 0, Py_TPFLAGS_DEFAULT | Py_TPFLAGS_HAVE_GC, slots };
    return PyType_FromSpec(&spec);
}

void hold(PyObject *self, PyObject *held)
{
    clear(self);
    ((Data *)PyObject_GetTypeData(self, Py_TYPE(self)))->held = Py_NewRef(held);
}
