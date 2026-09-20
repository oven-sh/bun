#if defined X
X
#endif

#if defined(X)
X
#endif

#if X
X
#endif

#define X 0

#if X
X
#endif

#if defined(X)
int x = 0;
#endif

#undef X
#define X 1

#if X
int
main()
{
	return 0;
}
#endif
