int
main()
{
	union { int a; int b; } u;
	u.a = 1;
	u.b = 3;
	
	if (u.a != 3 || u.b != 3)
		return 1;
	return 0;
}
