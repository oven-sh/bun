int
zero()
{
	return 0;
}

int
one()
{
	return 1;
}

int
main()
{
	int x;
	int y;
	
	x = zero();
	y = ++x;
	if (x != 1)
		return 1;
	if (y != 1)
		return 2;
	
	x = one();	
	y = --x;
	if (x != 0)
		return 3;
	if (y != 0)
		return 4;
	
	x = zero();
	y = x++;
	if (x != 1)
		return 5;
	if (y != 0)
		return 6;
	
	x = one();
	y = x--;
	if (x != 0)
		return 7;
	if (y != 1)
		return 8;
	
	return 0;
}
