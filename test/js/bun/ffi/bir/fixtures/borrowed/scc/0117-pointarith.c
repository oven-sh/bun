int
main()
{
	int i, *p = &i;

	return p - (int*) 0 == 0;
}
