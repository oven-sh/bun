int
main()
{
	int x = 0;
	int y = 1;
	if(x ? 1 : 0)
		return 1;
	if(y ? 0 : 1)
		return 2;
	return 0;
}
