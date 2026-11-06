/* For the scripts in here/: every function of the API, called by somebody who may be refused. Nothing is to happen then, and nothing is to crash. */
#include <Python.h>
#include <stdio.h>

/* What a library reads as it is loaded, whoever loads it and whenever, and keeps. */
static PyObject *kept_exception;
static PyObject *kept_type;
static PyObject *held;

__attribute__((constructor)) static void keep(void)
{
    kept_exception = PyExc_ValueError;
    kept_type = (PyObject *)&PyLong_Type;
}

int kept_is_null(void) { return !kept_exception || !kept_type; }
void hold(PyObject *object) { held = Py_NewRef(object); }
void raise_what_was_kept(const char *message) { PyErr_SetString(kept_exception, message); }
/* What is no exception, and belongs to no realm. */
void leave_a_str_in_the_indicator(void) { PyErr_SetRaisedException(PyUnicode_FromString("left in the indicator")); }

/* With `x` for every argument that is an object. In the order of include/declarations.h; capi.test.ts looks whether all of them are named here. */
static char answers[1024];
static const char *call_everything(PyObject *x)
{
    char *to = answers;
#define SAY(format, ...) to += snprintf(to, sizeof answers - (size_t)(to - answers), format " ", __VA_ARGS__)
#define SAY_WHETHER_NULL(value) SAY("%s", (value) ? "object" : "NULL")
    _Py_IncRef(x);
    _Py_DecRef(x);
    Py_IncRef(x);
    Py_DecRef(x);
    SAY("%d", Py_NewRef(x) == x);
    SAY("%d", Py_XNewRef(x) == x);
    Py_DecRef(x);
    Py_DecRef(x);
    SAY("%ld", (long)Py_REFCNT(x));
    SAY_WHETHER_NULL(Py_TYPE(x));
    SAY("%d", Py_IS_TYPE(x, (PyTypeObject *)x));
    SAY("%d", Py_Is(x, x));
    SAY("%d%d%d", Py_IsNone(x), Py_IsTrue(x), Py_IsFalse(x));
    for (unsigned id = 0; id <= 10; id++) {
        PyObject *constant = Py_GetConstant(id);
        SAY("%d", (constant != NULL) + (constant == Py_GetConstantBorrowed(id)));
        Py_XDECREF(constant);
    }
    PyErr_Clear();
    SAY("| %d", Py_IsInitialized());

    SAY_WHETHER_NULL(PyErr_Occurred());
    SAY_WHETHER_NULL(PyErr_GetRaisedException());
    PyErr_SetRaisedException(Py_NewRef(x));
    SAY_WHETHER_NULL(PyErr_Occurred());
    PyErr_Clear();
    PyErr_SetObject(x, x);
    SAY_WHETHER_NULL(PyErr_Occurred());
    PyErr_SetNone(x);
    SAY_WHETHER_NULL(PyErr_Occurred());
    PyErr_SetString(x, "text");
    SAY_WHETHER_NULL(PyErr_Occurred());
    SAY("%d", PyErr_GivenExceptionMatches(x, x));
    SAY("%d |", PyErr_ExceptionMatches(x));
    PyErr_Clear();

#define SAY_AND_GIVE_BACK(made) \
    { \
        PyObject *object = made; \
        SAY_WHETHER_NULL(object); \
        Py_XDECREF(object); \
        PyErr_Clear(); \
    }
    SAY_AND_GIVE_BACK(PyObject_Repr(x));
    SAY_AND_GIVE_BACK(PyUnicode_FromString("text"));
    SAY_AND_GIVE_BACK(PyLong_FromLong(5));
    SAY_AND_GIVE_BACK(PyLong_FromLong(INTPTR_MAX));
    SAY("%ld", PyLong_AsLong(x));
    PyErr_Clear();
    SAY_AND_GIVE_BACK(PyFloat_FromDouble(1.5));
    SAY("%g", PyFloat_AsDouble(x));
    PyErr_Clear();
    SAY_AND_GIVE_BACK(PyTuple_New(1));
    SAY("%ld", (long)PyTuple_Size(x));
    PyErr_Clear();
    SAY_WHETHER_NULL(PyTuple_GetItem(x, 0));
    PyErr_Clear();
    SAY("%d", PyTuple_SetItem(x, 0, Py_NewRef(x)));
    PyErr_Clear();
    SAY_AND_GIVE_BACK(PyList_New(1));
    SAY("%ld", (long)PyList_Size(x));
    PyErr_Clear();
    SAY_WHETHER_NULL(PyList_GetItem(x, 0));
    PyErr_Clear();
    SAY("%d", PyList_SetItem(x, 0, Py_NewRef(x)));
    PyErr_Clear();
    SAY("%d |", PyList_Append(x, x));
    PyErr_Clear();

    /* Memory is given to everybody. What PyObject_Free() is handed may be an object, so it asks. */
#define SAY_AND_FREE(allocate, allocate_zeroed, reallocate, release) \
    { \
        void *memory = reallocate(allocate(8), 600), *zeroed = allocate_zeroed(2, 300); \
        SAY("%d%d", memory != NULL, zeroed != NULL); \
        release(memory); \
        release(zeroed); \
    }
    SAY_AND_FREE(PyMem_Malloc, PyMem_Calloc, PyMem_Realloc, PyMem_Free);
    SAY_AND_FREE(PyMem_RawMalloc, PyMem_RawCalloc, PyMem_RawRealloc, PyMem_RawFree);
    SAY_AND_FREE(PyObject_Malloc, PyObject_Calloc, PyObject_Realloc, PyObject_Free);

    static PyType_Slot slots[] = {{0, NULL}};
    static PyType_Spec spec = {"everything.Made", -8, 0, Py_TPFLAGS_DEFAULT, slots};
    PyTypeObject *type = (PyTypeObject *)x;
    SAY_AND_GIVE_BACK(PyType_FromSpecWithBases(&spec, x));
    SAY_AND_GIVE_BACK(PyType_FromModuleAndSpec(x, &spec, x));
    SAY_AND_GIVE_BACK(PyType_FromMetaclass(type, x, &spec, x));
    /* Who is served has a type and an instance of his own for what follows. */
    PyObject *made = PyType_FromSpec(&spec);
    SAY_WHETHER_NULL(made);
    if (made)
        type = (PyTypeObject *)made;
    SAY("%d", PyType_IsSubtype(type, type));
    SAY_WHETHER_NULL(PyType_GetSlot(type, Py_tp_alloc));
    SAY("%ld", (long)PyType_GetTypeDataSize(type));
    SAY_AND_GIVE_BACK(_PyObject_New(type));
    SAY_AND_GIVE_BACK(_PyObject_GC_New(type));
    PyObject *instance = PyType_GenericAlloc(type, 0);
    SAY_WHETHER_NULL(instance);
    PyObject *y = instance ? instance : x;
    SAY_WHETHER_NULL(PyObject_GetTypeData(y, type));
    SAY_WHETHER_NULL(PyObject_GetTypeData_DuringGC(y, type));
    PyObject_GC_Track(y);
    SAY("%d", PyObject_GC_IsTracked(y));
    PyObject_GC_UnTrack(y);
    SAY("%d", PyObject_GC_IsFinalized(y));
    SAY("%d", PyObject_CallFinalizerFromDealloc(y));
    PyObject_ClearWeakRefs(y);
    PyObject_GC_Del(y);
    Py_XDECREF(made);
    PyErr_Clear();
    to[-1] = 0;
    return answers;
}

const char *call_everything_with(int what) { return call_everything(what == 0 ? kept_exception : what == 1 ? kept_type : held); }
