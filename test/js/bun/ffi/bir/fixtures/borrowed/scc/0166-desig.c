struct S {
	int a, b, c;
	char d[3];
	int e;
} s = {
	.a = 1,
	.b = 2,
	.d = {[0] = 3, [2] = 5},
	.d = {[0] = 4, [1] = 6}
};

int
main(void)
{
	if (s.a != 1)
		return 1;
	if (s.b != 2)
		return 2;
	if (s.d[0] != 4)
		return 3;
	if (s.d[1] != 6)
		return 4;
	if (s.d[2] != 0)
		return 5;
	return 0;
}
