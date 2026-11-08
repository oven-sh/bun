/* two_threads.py has the types of lifecycle.c. */
#include "lifecycle.c"

/* A tree of nodes that nobody but C has seen: node i gets the references to nodes 2 i + 1 and 2 i + 2. */
#define FAMILY 15
static PyObject *family[FAMILY];
void make_member(long id) { family[id] = new_node(id); }
void make_family(void)
{
    for (long i = 0; 2 * i + 2 < FAMILY; i++) {
        node_of(family[i])->first = family[2 * i + 1];
        node_of(family[i])->second = family[2 * i + 2];
    }
}
void drop_family(void) { Py_CLEAR(family[0]); }

/* The same, of whatever type that derives from Node. */
void make_member_of(PyObject *type, long index, long id)
{
    family[index] = ((allocfunc)PyType_GetSlot((PyTypeObject *)type, Py_tp_alloc))((PyTypeObject *)type, 0);
    node_of(family[index])->id = id;
}
void make_family_of_three(void)
{
    node_of(family[0])->first = family[1];
    node_of(family[0])->second = family[2];
}
