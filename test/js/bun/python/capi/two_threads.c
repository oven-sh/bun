/* two_threads.py has the types of lifecycle.c. */
#include "lifecycle.c"

/* Three nodes that nobody but C has seen. The first gets the references to the other two. */
static PyObject *family[3];
void make_member(long id) { family[id] = new_node(id); }
void make_family(void)
{
    node_of(family[0])->first = family[1];
    node_of(family[0])->second = family[2];
}
void drop_family(void) { Py_CLEAR(family[0]); }
