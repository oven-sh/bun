extern struct X x;
int foo();

int main()
{
	extern struct X x;
	return &x == 0;
}

struct X {int v;} x;

int foo()
{
	x.v = 0;
	return x.v;
}
