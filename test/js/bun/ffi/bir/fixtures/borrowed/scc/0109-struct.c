struct S1 { int x; };
struct S2 { struct S1 s1; };

int
main()
{
	struct S2 s2;
	s2.s1.x = 1;
	return 0;
}
