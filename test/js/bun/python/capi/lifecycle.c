/* Loaded with ctypes.PyDLL by lifecycle.py: types that C makes, what their instances hold, and how they end. */
#include <Python.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

/* ---- What has happened, in order. Noted without a call of the API. ---- */

enum { DEALLOC = 1, CLEAR = 2, FINALIZE = 3, PROBE = 4, TYPE = 5 };
#define EVENTS 65536
static long events[EVENTS];
static long number_of_events;
/* For at_exit.py: when nobody is left to ask. */
static long notes_aloud;
void note_aloud(long on) { notes_aloud = on; }

static void note(long kind, long id)
{
    if (notes_aloud) {
        char line[32];
        int length = snprintf(line, sizeof line, "%ld\n", kind * 1000000 + id);
        if (write(1, line, length) != length)
            return;
    }
    if (number_of_events < EVENTS)
        events[number_of_events++] = kind * 1000000 + id;
}

PyObject *take_events(void)
{
    PyObject *list = PyList_New(number_of_events);
    if (!list)
        return NULL;
    for (long i = 0; i < number_of_events; i++)
        PyList_SetItem(list, i, PyLong_FromLong(events[i]));
    number_of_events = 0;
    return list;
}

/* ---- Node: two references that the collector is told of ---- */

typedef struct {
    long id;
    PyObject *first;
    PyObject *second;
} Node;

static PyTypeObject *node_type;

/* For here/rude.py: what a tp_traverse must not do. */
static int is_rude;
static long rude_calls, rude_calls_refused;
void be_rude(int on) { is_rude = on; }
long count_rude_calls(void) { return rude_calls; }
long count_rude_calls_refused(void) { return rude_calls_refused; }

static int node_traverse(PyObject *self, visitproc visit, void *arg)
{
    Node *node = PyObject_GetTypeData_DuringGC(self, node_type);
    if (is_rude) {
        rude_calls += 2;
        rude_calls_refused += !PyList_New(0);
        rude_calls_refused += !PyObject_Repr(self);
        Py_INCREF(self);
    }
    Py_VISIT(Py_TYPE(self));
    Py_VISIT(node->first);
    Py_VISIT(node->second);
    return 0;
}

static int node_clear(PyObject *self)
{
    Node *node = PyObject_GetTypeData(self, node_type);
    note(CLEAR, node->id);
    Py_CLEAR(node->first);
    Py_CLEAR(node->second);
    return 0;
}

/* Without the API: for JS. */
int count_events(void) { return (int)number_of_events; }

/* What a tp_dealloc can ask the type of its object. */
static long looks_at_type;
void look_at_type(long on) { looks_at_type = on; }

/* Whom a tp_dealloc tells, and of what. */
static PyObject *told;
static long tells_of_children, tells_of_itself, raises_at_its_end;

/* Code of the program's that a tp_dealloc calls. */
static void (*at_dealloc)(long id);
void call_at_dealloc(void (*function)(long id)) { at_dealloc = function; }

static void node_dealloc(PyObject *self)
{
    PyTypeObject *type = Py_TYPE(self);
    Node *node = PyObject_GetTypeData(self, node_type);
    PyObject_GC_UnTrack(self);
    if (looks_at_type)
        note(TYPE, 1000 * (type == node_type) + 100 * Py_IS_TYPE(self, type) + 10 * PyType_IsSubtype(type, node_type) + !!PyType_GetSlot(type, Py_tp_free));
    note(DEALLOC, node->id);
    if (told && tells_of_itself)
        PyList_Append(told, self);
    if (at_dealloc)
        at_dealloc(node->id);
    Py_CLEAR(node->first);
    Py_CLEAR(node->second);
    ((freefunc)PyType_GetSlot(type, Py_tp_free))(self);
    Py_DECREF(type);
}

static PyType_Slot node_slots[] = {
    { Py_tp_doc, "Two references." },
    { Py_tp_traverse, node_traverse },
    { Py_tp_clear, node_clear },
    { Py_tp_dealloc, node_dealloc },
    { 0, NULL },
};
static PyType_Spec node_spec = { "lifecycle.Node", -(int)sizeof(Node), 0, Py_TPFLAGS_DEFAULT | Py_TPFLAGS_BASETYPE | Py_TPFLAGS_HAVE_GC, node_slots };

/* ---- Wide: derives from Node, adds a lot, and leaves its end to Node ---- */

#define WIDTH 40000
typedef struct {
    unsigned char bytes[WIDTH];
} Wide;

static PyTypeObject *wide_type;
static PyType_Slot wide_slots[] = { { 0, NULL } };
static PyType_Spec wide_spec = { "lifecycle.Wide", -(int)sizeof(Wide), 0, Py_TPFLAGS_DEFAULT | Py_TPFLAGS_BASETYPE, wide_slots };

/* ---- Watched: a Node with a finalizer ---- */

typedef struct {
    long on_finalize; /* 0: note it. 1: and keep the object. 2: and keep what `first` refers to. 3: and raise (see capi.test.ts). */
} Watched;

static PyTypeObject *watched_type;
static PyObject *kept;

static void watched_finalize(PyObject *self)
{
    Node *node = PyObject_GetTypeData(self, node_type);
    Watched *watched = PyObject_GetTypeData(self, watched_type);
    note(FINALIZE, node->id);
    if (watched->on_finalize == 1) {
        Py_XDECREF(kept);
        kept = Py_NewRef(self);
    } else if (watched->on_finalize == 2) {
        Py_XDECREF(kept);
        kept = Py_XNewRef(node->first);
    } else if (watched->on_finalize == 3)
        PyErr_SetString(PyExc_ValueError, "raised by tp_finalize");
}

static PyType_Slot watched_slots[] = {
    { Py_tp_finalize, watched_finalize },
    { 0, NULL },
};
static PyType_Spec watched_spec = { "lifecycle.Watched", -(int)sizeof(Watched), 0, Py_TPFLAGS_DEFAULT | Py_TPFLAGS_BASETYPE, watched_slots };

/* ---- Leaf: a reference that the collector is not told of ---- */

typedef struct {
    long id;
    PyObject *held;
} Leaf;

static PyTypeObject *leaf_type;

static void leaf_dealloc(PyObject *self)
{
    PyTypeObject *type = Py_TYPE(self);
    Leaf *leaf = PyObject_GetTypeData(self, leaf_type);
    note(DEALLOC, leaf->id);
    Py_CLEAR(leaf->held);
    ((freefunc)PyType_GetSlot(type, Py_tp_free))(self);
    Py_DECREF(type);
}

static PyType_Slot leaf_slots[] = {
    { Py_tp_dealloc, leaf_dealloc },
    { 0, NULL },
};
static PyType_Spec leaf_spec = { "lifecycle.Leaf", -(int)sizeof(Leaf), 0, Py_TPFLAGS_DEFAULT, leaf_slots };

/* ---- Chatty: a Node whose tp_dealloc makes objects, and tells the program ---- */

static PyTypeObject *chatty_type;

static void chatty_dealloc(PyObject *self)
{
    PyTypeObject *type = Py_TYPE(self);
    Node *node = PyObject_GetTypeData(self, node_type);
    PyObject *raised = PyErr_GetRaisedException();
    PyObject_GC_UnTrack(self);
    note(DEALLOC, node->id);
    for (int i = 0; i < 200; i++) {
        PyObject *list = PyList_New(100);
        Py_XDECREF(list);
    }
    if (told && tells_of_itself)
        PyList_Append(told, self);
    else if (told && tells_of_children) {
        /* The program gets hold of what the object refers to. */
        if (node->first)
            PyList_Append(told, node->first);
    } else if (told) {
        PyObject *id = PyLong_FromLong(node->id);
        if (id)
            PyList_Append(told, id);
        Py_XDECREF(id);
    }
    Py_CLEAR(node->first);
    Py_CLEAR(node->second);
    PyErr_SetRaisedException(raised);
    ((freefunc)PyType_GetSlot(type, Py_tp_free))(self);
    Py_DECREF(type);
    /* For here/raises.py. */
    if (raises_at_its_end)
        PyErr_SetString(PyExc_ValueError, "raised by tp_dealloc");
}

static PyType_Slot chatty_slots[] = {
    { Py_tp_dealloc, chatty_dealloc },
    { 0, NULL },
};
static PyType_Spec chatty_spec = { "lifecycle.Chatty", 0, 0, Py_TPFLAGS_DEFAULT, chatty_slots };

/* ---- Prober: a Node whose tp_dealloc asks for the data of an object to which C has kept a pointer that it does not own ---- */
/* (Only where that is not the end of the process: see capi.test.ts.) */

static PyTypeObject *prober_type;
static PyObject *borrowed;

void probe_borrowed(void)
{
    if (borrowed) {
        PyObject *raised = PyErr_GetRaisedException();
        Node *other = PyObject_GetTypeData(borrowed, node_type);
        note(PROBE, other ? other->id : 0);
        PyErr_SetRaisedException(raised);
    }
}

static void prober_dealloc(PyObject *self)
{
    probe_borrowed();
    node_dealloc(self);
}

static PyType_Slot prober_slots[] = {
    { Py_tp_dealloc, prober_dealloc },
    { 0, NULL },
};
static PyType_Spec prober_spec = { "lifecycle.Prober", 0, 0, Py_TPFLAGS_DEFAULT, prober_slots };

/* ---- Guarded: a Node that holds on to itself while it lets go of the others ---- */

static PyTypeObject *guarded_type;

static int guarded_clear(PyObject *self)
{
    Py_INCREF(self);
    node_clear(self);
    Py_DECREF(self);
    return 0;
}

static PyType_Slot guarded_slots[] = {
    { Py_tp_traverse, node_traverse },
    { Py_tp_clear, guarded_clear },
    { 0, NULL },
};
static PyType_Spec guarded_spec = { "lifecycle.Guarded", 0, 0, Py_TPFLAGS_DEFAULT | Py_TPFLAGS_HAVE_GC, guarded_slots };

/* ---- Careless: tells the collector of a reference, and never gives it back ---- */

typedef struct {
    PyObject *held;
} Careless;

static PyTypeObject *careless_type;

static int careless_traverse(PyObject *self, visitproc visit, void *arg)
{
    Careless *careless = PyObject_GetTypeData_DuringGC(self, careless_type);
    Py_VISIT(Py_TYPE(self));
    Py_VISIT(careless->held);
    return 0;
}

static PyType_Slot careless_slots[] = {
    { Py_tp_traverse, careless_traverse },
    { 0, NULL },
};
static PyType_Spec careless_spec = { "lifecycle.Careless", -(int)sizeof(Careless), 0, Py_TPFLAGS_DEFAULT | Py_TPFLAGS_HAVE_GC, careless_slots };

/* ---- Bare: some bytes, and nothing to do at the end ---- */

static PyTypeObject *bare_type;
static PyType_Slot bare_slots[] = { { 0, NULL } };
static PyType_Spec bare_spec = { "lifecycle.Bare", -24, 0, Py_TPFLAGS_DEFAULT, bare_slots };

/* ---- For the script ---- */

PyObject *make_types(void)
{
    if (!(node_type = (PyTypeObject *)PyType_FromSpec(&node_spec))
        || !(wide_type = (PyTypeObject *)PyType_FromSpecWithBases(&wide_spec, (PyObject *)node_type))
        || !(watched_type = (PyTypeObject *)PyType_FromSpecWithBases(&watched_spec, (PyObject *)node_type))
        || !(chatty_type = (PyTypeObject *)PyType_FromSpecWithBases(&chatty_spec, (PyObject *)node_type))
        || !(leaf_type = (PyTypeObject *)PyType_FromSpec(&leaf_spec))
        || !(bare_type = (PyTypeObject *)PyType_FromSpec(&bare_spec))
        || !(prober_type = (PyTypeObject *)PyType_FromSpecWithBases(&prober_spec, (PyObject *)node_type))
        || !(careless_type = (PyTypeObject *)PyType_FromSpec(&careless_spec))
        || !(guarded_type = (PyTypeObject *)PyType_FromSpecWithBases(&guarded_spec, (PyObject *)node_type)))
        return NULL;
    PyTypeObject *types[] = { node_type, wide_type, watched_type, chatty_type, leaf_type, bare_type, prober_type, careless_type, guarded_type };
    PyObject *result = PyTuple_New(9);
    for (int i = 0; result && i < 9; i++)
        PyTuple_SetItem(result, i, Py_NewRef((PyObject *)types[i]));
    return result;
}

/* ---- Stubborn: a Node whose tp_clear lets go of nothing (for here/faceless.py) ---- */

static int stubborn_clear(PyObject *self)
{
    note(CLEAR, ((Node *)PyObject_GetTypeData(self, node_type))->id);
    return 0;
}

static PyType_Slot stubborn_slots[] = {
    { Py_tp_traverse, node_traverse },
    { Py_tp_clear, stubborn_clear },
    { 0, NULL },
};
static PyType_Spec stubborn_spec = { "lifecycle.Stubborn", 0, 0, Py_TPFLAGS_DEFAULT | Py_TPFLAGS_HAVE_GC, stubborn_slots };

PyObject *make_stubborn_type(void) { return PyType_FromSpecWithBases(&stubborn_spec, (PyObject *)node_type); }

static Node *node_of(PyObject *object) { return PyObject_GetTypeData(object, node_type); }

void set_id(PyObject *object, long id)
{
    if (PyType_IsSubtype(Py_TYPE(object), leaf_type))
        ((Leaf *)PyObject_GetTypeData(object, leaf_type))->id = id;
    else
        node_of(object)->id = id;
}

long get_id(PyObject *object) { return node_of(object)->id; }

void set_first(PyObject *object, PyObject *value)
{
    PyObject *old = node_of(object)->first;
    node_of(object)->first = Py_NewRef(value);
    Py_XDECREF(old);
}

void set_second(PyObject *object, PyObject *value)
{
    PyObject *old = node_of(object)->second;
    node_of(object)->second = Py_NewRef(value);
    Py_XDECREF(old);
}

PyObject *get_first(PyObject *object)
{
    PyObject *value = node_of(object)->first;
    return Py_NewRef(value ? value : Py_None);
}

void set_held(PyObject *leaf, PyObject *value)
{
    Leaf *data = PyObject_GetTypeData(leaf, leaf_type);
    PyObject *old = data->held;
    data->held = Py_NewRef(value);
    Py_XDECREF(old);
}

void set_held_carelessly(PyObject *careless, PyObject *value) { ((Careless *)PyObject_GetTypeData(careless, careless_type))->held = Py_NewRef(value); }

void set_on_finalize(PyObject *object, long what) { ((Watched *)PyObject_GetTypeData(object, watched_type))->on_finalize = what; }

PyObject *take_kept(void)
{
    PyObject *result = kept ? kept : Py_NewRef(Py_None);
    kept = NULL;
    return result;
}

void tell(PyObject *list)
{
    Py_XDECREF(told);
    told = Py_IsNone(list) ? NULL : Py_NewRef(list);
}

void tell_of_children(long whether) { tells_of_children = whether; }
void tell_of_itself(long whether) { tells_of_itself = whether; }

/* Made by C: by tp_alloc, and as PyObject_GC_New() makes them. */
PyObject *new_node(long id)
{
    PyObject *object = ((allocfunc)PyType_GetSlot(node_type, Py_tp_alloc))(node_type, 0);
    if (object)
        node_of(object)->id = id;
    return object;
}

PyObject *new_node_untracked(long id)
{
    PyObject *object = (PyObject *)PyObject_GC_New(PyObject, node_type);
    if (object) {
        /* CPython leaves the memory as it finds it. */
        memset(node_of(object), 0, sizeof(Node));
        node_of(object)->id = id;
    }
    return object;
}

void track(PyObject *object) { PyObject_GC_Track(object); }
long is_tracked(PyObject *object) { return PyObject_GC_IsTracked(object); }
PyObject *type_by_c(PyObject *object) { return Py_NewRef((PyObject *)Py_TYPE(object)); }
long is_finalized(PyObject *object) { return PyObject_GC_IsFinalized(object); }

/* A chain of n nodes that only C has seen; the first is returned. */
PyObject *new_chain(long first_id, long n)
{
    PyObject *head = NULL;
    for (long i = n - 1; i >= 0; i--) {
        PyObject *object = new_node(first_id + i);
        if (!object)
            return NULL;
        node_of(object)->first = head;
        head = object;
    }
    return head;
}

/* A ring of n nodes that only C has seen, and that it lets go of at once. */
long drop_ring(long first_id, long n)
{
    PyObject *head = new_chain(first_id, n);
    if (!head)
        return -1;
    PyObject *last = head;
    while (node_of(last)->first)
        last = node_of(last)->first;
    node_of(last)->first = head; /* The reference that new_chain() returned. */
    return n;
}

void remember_borrowed(PyObject *object) { borrowed = Py_IsNone(object) ? NULL : object; }
PyObject *recall_borrowed(void) { return Py_NewRef(borrowed); }
/* The list takes a reference of its own. C takes none. */
int append_borrowed(PyObject *list) { return PyList_Append(list, borrowed); }
/* C takes a reference by that pointer, and tells nobody. */
static PyObject *kept_by_c;
void keep_borrowed(void) { kept_by_c = Py_NewRef(borrowed); }
void drop_what_c_kept(void) { Py_CLEAR(kept_by_c); }
long has_first(PyObject *object) { return node_of(object)->first != NULL; }
/* With what PyObject_GetTypeData() raised, if it did. */
long id_or_exception(PyObject *object)
{
    Node *node = node_of(object);
    return node ? node->id : -1;
}
void raise_at_its_end(long on) { raises_at_its_end = on; }
long id_of_borrowed_if_it_has_data(void);
long id_if_it_has_data(PyObject *object)
{
    Node *node = PyObject_GetTypeData(object, node_type);
    if (!node)
        PyErr_Clear();
    return node ? node->id : -1;
}

long id_of_borrowed_if_it_has_data(void) { return id_if_it_has_data(borrowed); }

/* Where the parts of an object lie, and what is in them at first. */
long size_of_data(PyObject *type) { return (long)PyType_GetTypeDataSize((PyTypeObject *)type); }

long alignment_of_data(PyObject *object, PyObject *type)
{
    uintptr_t address = (uintptr_t)PyObject_GetTypeData(object, (PyTypeObject *)type);
    return address ? (long)(address % 16) : -1;
}

long distance_of_parts(PyObject *object)
{
    return (long)((char *)PyObject_GetTypeData(object, wide_type) - (char *)PyObject_GetTypeData(object, node_type));
}

/* 0: all of it was zero, and it holds what is written to it. */
long try_width(PyObject *object, long seed)
{
    Wide *wide = PyObject_GetTypeData(object, wide_type);
    long wrong = 0;
    for (long i = 0; i < WIDTH; i++)
        wrong += wide->bytes[i] != 0;
    for (long i = 0; i < WIDTH; i++)
        wide->bytes[i] = (unsigned char)(i * 7 + seed);
    return wrong;
}

long check_width(PyObject *object, long seed)
{
    Wide *wide = PyObject_GetTypeData(object, wide_type);
    long wrong = 0;
    for (long i = 0; i < WIDTH; i++)
        wrong += wide->bytes[i] != (unsigned char)(i * 7 + seed);
    return wrong;
}

/* Memory that is not an object's. */
long try_memory(void)
{
    long wrong = 0;
    char *a = PyMem_Malloc(0), *b = PyMem_Calloc(10, 100), *c = PyObject_Malloc(33), *d = PyMem_RawMalloc(5), *e = PyObject_Calloc(3, 3), *f = PyMem_RawCalloc(1, 1);
    wrong += !a + !b + !c + !d + !e + !f;
    for (int i = 0; i < 1000; i++)
        wrong += b[i] != 0;
    memset(c, 'x', 33);
    c = PyObject_Realloc(c, 100000);
    for (int i = 0; i < 33; i++)
        wrong += c[i] != 'x';
    b = PyMem_Realloc(b, 1);
    d = PyMem_RawRealloc(d, 50);
    wrong += PyMem_Calloc((size_t)-1, 16) != NULL;
    PyMem_Free(a);
    PyMem_Free(b);
    PyObject_Free(c);
    PyMem_RawFree(d);
    PyObject_Free(e);
    PyMem_RawFree(f);
    PyMem_Free(NULL);
    PyObject_Free(NULL);
    return wrong;
}

/* ---- More types, each made when it is asked for ---- */

long count_of(PyObject *object) { return (long)Py_REFCNT(object); }

static PyType_Slot no_slots[] = { { 0, NULL } };
PyObject *make_with_bases(PyObject *bases)
{
    static PyType_Spec spec = { "lifecycle.Derived", 0, 0, Py_TPFLAGS_DEFAULT | Py_TPFLAGS_BASETYPE, no_slots };
    return PyType_FromSpecWithBases(&spec, bases);
}
PyObject *make_with_metaclass(PyObject *metaclass)
{
    static PyType_Spec spec = { "lifecycle.OfMetaclass", 0, 0, Py_TPFLAGS_DEFAULT | Py_TPFLAGS_BASETYPE, no_slots };
    return PyType_FromMetaclass((PyTypeObject *)metaclass, NULL, &spec, NULL);
}
PyObject *make_immutable(void)
{
    static PyType_Spec spec = { "lifecycle.Immutable", 0, 0, Py_TPFLAGS_DEFAULT | Py_TPFLAGS_BASETYPE | Py_TPFLAGS_IMMUTABLETYPE, no_slots };
    return PyType_FromSpec(&spec);
}
PyObject *make_immutable_from_mutable(void)
{
    static PyType_Spec spec = { "lifecycle.ImmutableNode", 0, 0, Py_TPFLAGS_DEFAULT | Py_TPFLAGS_IMMUTABLETYPE, no_slots };
    return PyType_FromSpecWithBases(&spec, (PyObject *)node_type);
}
/* Py_tp_base and Py_tp_bases in one spec, in either order. */
PyObject *make_with_both_slots(PyObject *base, PyObject *bases, long base_first)
{
    PyType_Slot slots[] = { { Py_tp_base, base }, { Py_tp_bases, bases }, { 0, NULL } };
    if (!base_first) {
        slots[0].slot = Py_tp_bases, slots[0].pfunc = bases;
        slots[1].slot = Py_tp_base, slots[1].pfunc = base;
    }
    PyType_Spec spec = { "lifecycle.Both", 0, 0, Py_TPFLAGS_DEFAULT, slots };
    return PyType_FromSpec(&spec);
}

/* Big: much data, of which the collector is not told, so its tp_free is PyObject_Free(). And a tp_clear without Py_TPFLAGS_HAVE_GC, which nobody calls. */
typedef struct {
    long id;
    char much[200000];
    long last;
} Big;
static PyTypeObject *big_type;
static int big_clear(PyObject *self)
{
    note(CLEAR, ((Big *)PyObject_GetTypeData(self, big_type))->id);
    return 0;
}
static void big_dealloc(PyObject *self)
{
    PyTypeObject *type = Py_TYPE(self);
    Big *big = PyObject_GetTypeData(self, big_type);
    note(DEALLOC, big->id + big->last + big->much[100000]);
    ((freefunc)PyType_GetSlot(type, Py_tp_free))(self);
    Py_DECREF(type);
}
PyObject *make_big_type(void)
{
    static PyType_Slot slots[] = { { Py_tp_clear, big_clear }, { Py_tp_dealloc, big_dealloc }, { 0, NULL } };
    static PyType_Spec spec = { "lifecycle.Big", -(int)sizeof(Big), 0, Py_TPFLAGS_DEFAULT, slots };
    return Py_XNewRef((PyObject *)(big_type = (PyTypeObject *)PyType_FromSpec(&spec)));
}
void set_big(PyObject *object, long id, long last)
{
    Big *big = PyObject_GetTypeData(object, big_type);
    big->id = id, big->last = last;
}

/* Told: tells the collector of what it holds, and of its type, and has no tp_dealloc. With and without a tp_clear. */
typedef struct {
    PyObject *held;
} Told;
static PyTypeObject *told_type[2];
static int told_traverse(PyObject *self, visitproc visit, void *arg)
{
    PyTypeObject *type = Py_TYPE(self);
    Told *data = PyObject_GetTypeData_DuringGC(self, type);
    Py_VISIT(type);
    Py_VISIT(data->held);
    return 0;
}
static int told_clear(PyObject *self)
{
    Py_CLEAR(((Told *)PyObject_GetTypeData(self, Py_TYPE(self)))->held);
    return 0;
}
/* C keeps the only reference to the type. */
long make_told_type(long with_clear)
{
    static PyType_Slot slots[2][3] = { { { Py_tp_traverse, told_traverse }, { 0, NULL } }, { { Py_tp_traverse, told_traverse }, { Py_tp_clear, told_clear }, { 0, NULL } } };
    static PyType_Spec specs[2] = {
        { "lifecycle.Told", -(int)sizeof(Told), 0, Py_TPFLAGS_DEFAULT | Py_TPFLAGS_HAVE_GC, slots[0] },
        { "lifecycle.ToldAndCleared", -(int)sizeof(Told), 0, Py_TPFLAGS_DEFAULT | Py_TPFLAGS_HAVE_GC, slots[1] },
    };
    return !!(told_type[with_clear] = (PyTypeObject *)PyType_FromSpec(&specs[with_clear]));
}
PyObject *told_type_of(long with_clear) { return Py_NewRef((PyObject *)told_type[with_clear]); }
PyObject *new_told(long with_clear, PyObject *held)
{
    PyObject *object = ((allocfunc)PyType_GetSlot(told_type[with_clear], Py_tp_alloc))(told_type[with_clear], 0);
    if (object)
        ((Told *)PyObject_GetTypeData(object, told_type[with_clear]))->held = Py_NewRef(held);
    return object;
}

/* A constructor that gives up frees the memory itself, as many do: no tp_dealloc is called. */
long constructors_that_give_up(long n, long of_a_type_with_a_dealloc)
{
    PyTypeObject *type = of_a_type_with_a_dealloc ? node_type : told_type[0];
    long before = (long)Py_REFCNT((PyObject *)type);
    for (long i = 0; i < n; i++) {
        PyObject *object = (PyObject *)PyObject_GC_New(PyObject, type);
        if (!object)
            return -1;
        PyObject_GC_Del(object);
        Py_DECREF(type);
    }
    return (long)Py_REFCNT((PyObject *)type) - before;
}

/* Delegating: a Node with one reference more, whose tp_traverse leaves the rest to that of its base. */
typedef struct {
    PyObject *third;
} Delegating;
static PyTypeObject *delegating_type;
static int delegating_traverse(PyObject *self, visitproc visit, void *arg)
{
    Py_VISIT(((Delegating *)PyObject_GetTypeData_DuringGC(self, delegating_type))->third);
    return ((traverseproc)PyType_GetSlot(node_type, Py_tp_traverse))(self, visit, arg);
}
static int delegating_clear(PyObject *self)
{
    Py_CLEAR(((Delegating *)PyObject_GetTypeData(self, delegating_type))->third);
    return node_clear(self);
}
static void delegating_dealloc(PyObject *self)
{
    PyObject_GC_UnTrack(self);
    Py_CLEAR(((Delegating *)PyObject_GetTypeData(self, delegating_type))->third);
    node_dealloc(self);
}
PyObject *make_delegating_type(void)
{
    static PyType_Slot slots[] = { { Py_tp_traverse, delegating_traverse }, { Py_tp_clear, delegating_clear }, { Py_tp_dealloc, delegating_dealloc }, { 0, NULL } };
    static PyType_Spec spec = { "lifecycle.Delegating", -(int)sizeof(Delegating), 0, Py_TPFLAGS_DEFAULT | Py_TPFLAGS_HAVE_GC, slots };
    return Py_XNewRef((PyObject *)(delegating_type = (PyTypeObject *)PyType_FromSpecWithBases(&spec, (PyObject *)node_type)));
}
void set_third(PyObject *object, PyObject *value)
{
    Delegating *data = PyObject_GetTypeData(object, delegating_type);
    PyObject *old = data->third;
    data->third = Py_NewRef(value);
    Py_XDECREF(old);
}

/* Closed: only C makes instances. */
PyObject *make_closed_type(void)
{
    static PyType_Spec spec = { "lifecycle.Closed", 0, 0, Py_TPFLAGS_DEFAULT | Py_TPFLAGS_BASETYPE | Py_TPFLAGS_DISALLOW_INSTANTIATION, no_slots };
    return PyType_FromSpec(&spec);
}
