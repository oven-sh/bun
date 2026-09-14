int
main()
{
	struct T { int x; };
	{
		struct T s;
		s.x = 0;
		return s.x;
	}
}
