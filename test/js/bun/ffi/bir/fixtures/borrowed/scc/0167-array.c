int arr1[][3] = {
	{ 2, 7, 5, },
	{ 5, 1, 2, },
};

int arr2[2][3] = {
	2, 7, 5,
	5, 1, 2
};

int
main(void)
{
	return !(arr1[1][2] == arr2[1][2]);
}
