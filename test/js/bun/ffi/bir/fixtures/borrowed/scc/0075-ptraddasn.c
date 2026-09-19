int
main()
{
	int arr[2];
	int *p;
	
	p = &arr[0];
	p += 1;
	*p = 123;
	
	if(arr[1] != 123)
		return 1;
	return 0;
}
