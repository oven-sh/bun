int
main(void)
{
	int i = 0, *q;
	unsigned char *bp = 0;
	void *p;

	i = i ? 0 : 0l;
	p = i ? (void *) 0 : 0;
	p = i ? 0 : (void *) 0;
	p = i ? 0 : (const void *) 0;
	p = i ? (void *) 0 : bp-1;
	q = i ? 0 : p;
	q = i ? p : 0;
	q = i ? q : 0;
	q = i ? 0 : q;

	return (int) q;
}
