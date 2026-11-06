/* Loaded with ctypes.PyDLL by capi.test.ts: what a thread without the GIL does to a count. */
#include <Python.h>
#include <pthread.h>
#include <stdio.h>

static void *take(void *object)
{
    for (int i = 0; i < 1000; i++)
        Py_INCREF((PyObject *)object);
    return NULL;
}

static void *give_back(void *object)
{
    for (int i = 0; i < 1000; i++)
        Py_DECREF((PyObject *)object);
    return NULL;
}

/* To a function that takes a reference over, whatever comes of the call. */
static void *hand_over_to_indicator(void *object)
{
    PyErr_SetRaisedException((PyObject *)object);
    return NULL;
}
static void *hand_over_to_tuple(void *object)
{
    PyTuple_SetItem((PyObject *)object, 0, (PyObject *)object);
    return NULL;
}
static void *hand_over_to_list(void *object)
{
    PyList_SetItem((PyObject *)object, 0, (PyObject *)object);
    return NULL;
}

/* What is destroyed with a thread is destroyed in rounds, for as long as a destructor sets a value again. This one is there in every round. */
static pthread_key_t key;
static int rounds;

static void give_back_in_every_round(void *object)
{
    Py_DECREF((PyObject *)object);
    if (++rounds < 4)
        pthread_setspecific(key, object);
}

static void *give_back_at_the_end(void *object)
{
    Py_DECREF((PyObject *)object);
    pthread_setspecific(key, object);
    return NULL;
}

long rounds_at_the_end(void) { return rounds; }

/* The caller has the GIL and waits. How much the count has changed. */
long change_in_another_thread(PyObject *object, int what)
{
    Py_ssize_t before = Py_REFCNT(object);
    pthread_t thread;
    if (what == 2 && pthread_key_create(&key, give_back_in_every_round))
        return -1;
    void *(*const does[])(void *) = {take, give_back, give_back_at_the_end, hand_over_to_indicator, hand_over_to_tuple, hand_over_to_list};
    if (pthread_create(&thread, NULL, does[what], object))
        return -1;
    pthread_join(thread, NULL);
    return (long)(Py_REFCNT(object) - before);
}

void take_here(PyObject *object, long n) { while (n--) Py_INCREF(object); }
void give_back_here(PyObject *object, long n) { while (n--) Py_DECREF(object); }

/* Every function that looks at something fails. Those that look at nothing answer. */
static char answers[256];

static void *ask(void *object)
{
    PyObject *none = Py_None;
    PyErr_SetString(PyExc_ValueError, "from a thread without the GIL");
    snprintf(answers, sizeof answers, "%ld %d %d %d %d %d %ld %ld %d | %d %d %d %d", (long)Py_REFCNT((PyObject *)object), !Py_TYPE((PyObject *)object),
        Py_IS_TYPE((PyObject *)object, &PyList_Type), !PyErr_Occurred(), !PyList_New(0), !PyLong_FromLong(5), (long)PyList_Size((PyObject *)object),
        PyLong_AsLong((PyObject *)object), !PyObject_Repr((PyObject *)object),
        Py_IsInitialized(), Py_IsNone(none), Py_Is(none, Py_GetConstantBorrowed(Py_CONSTANT_NONE)), Py_IsTrue(Py_True));
    return NULL;
}

/* The caller has the GIL and waits. */
const char *ask_in_another_thread(PyObject *object)
{
    pthread_t thread;
    if (pthread_create(&thread, NULL, ask, object))
        return "no thread";
    pthread_join(thread, NULL);
    return answers;
}

/* On the thread that calls, whoever that is. */
const char *ask_here(PyObject *object)
{
    ask(object);
    return answers;
}

/* The length of the list, + 1, before it calls back and after: two digits. */
long sizes_around(PyObject *list, void (*callback)(void))
{
    long before = (long)PyList_Size(list) + 1;
    callback();
    return before * 10 + (long)PyList_Size(list) + 1;
}

/* The same, for when the interpreter that had the API has ended. */
static PyObject *held;
void hold(PyObject *object) { held = Py_NewRef(object); }
const char *ask_about_what_is_held(void)
{
    ask(held);
    Py_DECREF(held);
    Py_INCREF(held);
    return answers;
}

/* For whoever has loaded this without Python. */
int is_initialized(void) { return Py_IsInitialized(); }
