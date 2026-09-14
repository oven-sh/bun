struct str {
	int a;
	char v[];
};

int
main(void)
{
	struct str *p;
	int ary[20];

	p = (struct str *) ary;
	p->a = 2;
	p->v[0] = 1;

	return !(p->a + p->v[0] == 3);
}
