int
main()
{
	int x;
	
	x = 4;
	if(!x != 0)
		return 1;
	if(!!x != 1)
		return 1;
	if(-x != 0 - 4)
		return 1;
	return 0;
}

