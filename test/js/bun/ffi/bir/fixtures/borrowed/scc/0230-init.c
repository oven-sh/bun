struct a {
	int a;
	union b {
		int a;
		char b;
	} u;
};

int
main()
{
    struct a a = {0};

    return a.u.a;
}
