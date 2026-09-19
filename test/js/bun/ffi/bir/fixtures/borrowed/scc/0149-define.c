#define M(x) x
#define A(a,b) a(b)

int
main(void)
{
	char *a = A(M,"hi");

	return (a[1] == 'i') ? 0 : 1;
}
