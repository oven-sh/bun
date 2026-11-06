/* Loaded by first_by_cdll.py, with ctypes.CDLL first: C that calls nothing of the API comes to own a reference all the same. */
#include <Python.h>
#include <stdlib.h>

/* What a callback returns is C's. It is kept where no collector looks. */
typedef PyObject *(*makes)(void);
static PyObject **kept;
void keep_result_of(makes make)
{
    kept = malloc(sizeof *kept);
    *kept = make();
}
/* It goes on to whoever called. */
PyObject *result_of(makes make) { return make(); }

/* These are called with the GIL. */
long size_of_kept(void) { return (long)PyList_Size(*kept); }
PyObject *give_kept(void)
{
    PyObject *result = *kept;
    free(kept);
    kept = NULL;
    return result;
}
long count(PyObject *object) { return (long)Py_REFCNT(object); }
