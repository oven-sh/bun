#define A(x,y) x+y
#define B(x,y, ...) (x+y+ __VA_ARGS__ ## 0)
#define C(x, ...) test(x, __VA_ARGS__)

int
test(int n1, int n2, int n3, int n4)
{
	return n1 + n2 + n3 + n4;
}

int
main(void)
{
	int x = 3;

	if (A(1,x) != 4)
		return 1;
	if (B(1,x) != 4)
		return 2;
	if (B(2,x,3) != 35)
		return 3;
	if (C(1, 2, 3, 4) != 10)
		return 4;

	return 0;
}
