int
main()
{
	int arr[2];
	int *p;
	
	p = &arr[1];
	*p = 0;
	return arr[1];
}
