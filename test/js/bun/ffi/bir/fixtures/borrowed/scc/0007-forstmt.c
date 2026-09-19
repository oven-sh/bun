int
main()
{
	int x;
	
	x = 1;
	for(x = 10; x; x = x - 1)
		;
	if(x)
		return 1;
	x = 10;
	for (;x;)
		x = x - 1;
	return x;
}
