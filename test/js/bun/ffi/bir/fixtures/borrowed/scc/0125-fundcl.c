int f(int a), g(int a), a;


int
main()
{
	return f(1) - g(1);
}

int
f(int a)
{
	return a;
}

int
g(int a)
{
	return a;
}
