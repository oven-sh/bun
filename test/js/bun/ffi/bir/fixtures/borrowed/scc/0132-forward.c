struct S *x;
struct S {
	int i;
	struct S *next;
};

int
main(void)
{
	struct S y, *p;
	unsigned n;

	y.i = 0;
	y.next = 0;
	x = &y;
	*x = y;

	for (n = 0, p = &y; p; ++n, p = p->next)
		;
	return n-1;
}
