/* taken from ISO/IEC 9899:1999 Section 6.10.3.5 p5 */

int z[3] = {1, 0, 0};

int
f(int x)
{
	return x+1;
}

int
t(int x)
{
	return x+2;
}

int
m(int x, int y)
{
	return x+y;
}

#define    x          3
#define    f(a)       f(x * (a))
#undef     x

#define    x          2
#define    z          z[0]
#define    g          f
#define    h          g(~
#define    m(a)       a(w)
#define    w          0,1
#define    t(a)       a
#define    p()        int
#define    q(x)       x
#define    r(x,y)     x ## y
#define    str(x)     # x

int
test1()
{
	return f(z) == 3;
}

int
test2(int y)
{
	return f(y+1) + f(f(z)) % t(t(g)(0) + t)(1) == 10;
}

int
test3()
{
	return g(x+(3,4)-w) | h 5) & m
		(f)^m(m) == 3;
}

int
test4()
{
	p() i[q()] = { q(1), r(2,3), r(4,), r(,5), r(,) };

	return i[0] + i[1] + i[2] + i[3] == 33;
}

int
test5()
{
	int i;
	char c[2][6] = { str(hello), str() };

	for (i = 0; i < 6; i++) {
		if (c[0][i] != "hello"[i])
			return 0;
	}

	if (c[1][0] != '\0')
		return 0;

	return 1;
}

int
main()
{
	if (!test1())
		return 1;
	if (!test2(2))
		return 2;
	if (!test3())
		return 3;
	if (!test4())
		return 4;
	if (!test5())
		return 5;
	return 0;
}
