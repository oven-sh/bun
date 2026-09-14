int
main()
{
	int x, *p, **pp;
	
	x = 0;
	p = &x;
	pp = &p;
	return **pp;
}
