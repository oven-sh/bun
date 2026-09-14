int x;
int x = 3;
int x;

int main();

void *
foo()
{
	return &main;
}

int
main()
{
	if (x != 3)
		return 0;

	x = 0;
	return x;
}

