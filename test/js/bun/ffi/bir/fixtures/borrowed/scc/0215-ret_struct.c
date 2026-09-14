struct f {
	char fill[40];
	int a;
};

struct f
f1(struct f a)
{
	a.a += 2;
	return a;
}

struct f
f2(struct f a)
{
	struct f b;

	b.a = a.a + 2;
	return b;
}

int
main()
{
	struct f a, b;

	a.a = 1;
	b = f1(a);
	if (b.a != a.a + 2)
		return 1;
	b = f2(a);
	if (b.a != a.a + 2)
		return 2;

	return 0;
}
