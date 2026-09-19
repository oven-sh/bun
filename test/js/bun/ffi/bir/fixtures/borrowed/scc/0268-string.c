unsigned char s1[] = "hello";
signed char s2[] = "Hello";
char s3[] = "Hello World!";

int
main()
{
	if (s1[1] != s2[1] || s1[1] != s3[1])
		return 1;
	if (s1[2] != s2[2] || s1[2] != s3[2])
		return 2;
	if (s1[3] != s2[3] || s1[3] != s3[3])
		return 3;
	if (s1[4] != s2[4] || s1[4] != s3[4])
		return 4;
	return 0;
}
