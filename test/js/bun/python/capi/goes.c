/* Loaded by goes.py: what a library does as it goes. */
#include <Python.h>

static int what;
static PyObject *held;

void when_it_goes(int this) { what = this; }
void hold(PyObject *object) { held = Py_NewRef(object); }

__attribute__((destructor)) static void go(void)
{
    if (what == 1)
        PyErr_SetString(PyExc_RuntimeError, "from the destructor");
    if (what == 2) {
        Py_INCREF(held);
        PyErr_SetString(PyExc_RuntimeError, "from the destructor");
    }
}
