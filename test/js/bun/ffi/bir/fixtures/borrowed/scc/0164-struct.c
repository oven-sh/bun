struct S { int a; int b; };
struct S *s = &(struct S) { 1, 2 };

int
main()
{
	if(s->a != 1)
		return 1;
	if(s->b != 2)
		return 2;
	return 0;
}
