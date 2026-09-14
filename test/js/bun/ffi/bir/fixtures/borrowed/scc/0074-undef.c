#define X 1
#undef X

#ifdef X
FAIL
#endif

int
main()
{
	return 0;
}
