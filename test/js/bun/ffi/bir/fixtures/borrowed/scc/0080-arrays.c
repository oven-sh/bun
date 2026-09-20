int
foo(int x[100])
{
	int y[100];
	int *p;
	
	y[0] = 2000;
	
	if(x[0] != 1000)
	{
		return 1;
	}
	
	p = x;
	
	if(p[0] != 1000)
	{
		return 2;
	}
	
	p = y;
	
	if(p[0] != 2000)
	{
		return 3;
	}
	
	if(sizeof(x) != sizeof(void*))
	{
		return 4;
	}
	
	if(sizeof(y) <= sizeof(x))
	{
		return 5;
	}
	
	return 0;
}

int
main()
{
	int x[100];
	x[0] = 1000;
	
	return foo(x);
}
