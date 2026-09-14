struct S1 {
	int a;
	int b;
};
struct S2 {
	struct S1 s1;
	struct S1 *ps1;
	int arr[2];
};
struct S1 gs1 = {.a = 1, 2};
struct S2 *s = &(struct S2) {
	{.b = 2, .a = 1},
	&gs1,
	{[0] = 1,  1+1}
};

int
main()
{
	if(s->s1.a != 1)
		return 1;
	if(s->s1.b != 2)
		return 2;
	if(s->ps1->a != 1)
		return 3;
	if(s->ps1->b != 2)
		return 4;
	if(s->arr[0] != 1)
		return 5;
	if(s->arr[1] != 2)
		return 6;
	return 0;
}
