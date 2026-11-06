/* Loaded with ctypes.PyDLL by capi.test.ts: what a thread without the GIL does to a count. */
#include <Python.h>
#include <pthread.h>

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

/* The caller has the GIL and waits. How much the count has changed. */
long change_in_another_thread(PyObject *object, int gives_back)
{
    Py_ssize_t before = Py_REFCNT(object);
    pthread_t thread;
    if (pthread_create(&thread, NULL, gives_back ? give_back : take, object))
        return -1;
    pthread_join(thread, NULL);
    return (long)(Py_REFCNT(object) - before);
}

void take_here(PyObject *object, long n) { while (n--) Py_INCREF(object); }
void give_back_here(PyObject *object, long n) { while (n--) Py_DECREF(object); }
