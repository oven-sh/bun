/* https://www.open-std.org/jtc1/sc22/wg14/issues/c90/issue0047.html */

struct dummy;

extern struct dummy dummy1;

void *
fun(void)
{
	return &dummy1;
}

int
main()
{
	return fun() == 0;
}
