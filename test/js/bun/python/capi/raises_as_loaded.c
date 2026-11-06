/* Loaded by raises_as_loaded.py: a library that leaves an exception set when it has been loaded. */
#include <Python.h>

__attribute__((constructor)) static void load(void)
{
    PyErr_SetString(PyExc_RuntimeError, "from the constructor");
}

int seven(void) { return 7; }
