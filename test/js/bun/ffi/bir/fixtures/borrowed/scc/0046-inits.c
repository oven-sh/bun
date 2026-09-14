int x = 5;
long y = 6;
int *p = &x;

int
main()
{
	if (x != 5) 
		return 1;
	if (y != 6)
		return 2;
	if (*p != 5)
		return 3;
	return 0;
}

