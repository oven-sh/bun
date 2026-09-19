int
main()
{
	int x;
	
	x = 0;
	x += 2;
	x += 2;
	if (x != 4)
		return 1;
	x -= 1;
	if (x != 3)
		return 2;
	x *= 2;
	if (x != 6)
		return 3;
		
	return 0;
}
