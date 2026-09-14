struct range {
	long quant;
} a[] = {1, 0};

long b;

int
main()
{
	struct range r = a[0];
	b = r.quant;

	return (b == 1) ? 0 : 1;
}
