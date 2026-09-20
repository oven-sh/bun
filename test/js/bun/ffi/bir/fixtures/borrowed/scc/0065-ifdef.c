#ifdef FOO
	XXX
#ifdef BAR
	XXX
#endif
	XXX
#endif

#define FOO 1

#ifdef FOO

#ifdef FOO
int x = 0;
#endif

int
main()
{
	return x;
}
#endif



