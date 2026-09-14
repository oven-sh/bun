#define FOO

#ifdef FOO
	int a;
	int b;
	#undef FOO
	#ifndef FOO
		int c;
		int d;
	#else
		int e;
		int f;
	#endif
	int e;
	int f;
	#ifdef FOO
		int c_;
		int d_;
	#else
		int e_;
		int f_;
	#endif
	int e_;
	int f_;
int
main()
{
	return 0;
}
#else
	int j;
	int k;
	#ifdef FOO
		int j;
		int k;
	#else
		int n;
		int o;
	#endif
	int n;
	int o;
	#ifndef FOO
		int r;
		int s;
	#else
		int t;
		int u;
	#endif
	int t;
	int u;
	#error bad branch
#endif
