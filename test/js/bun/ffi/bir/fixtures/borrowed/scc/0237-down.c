/*
 * Regression test for incorrect typing in binary operations
 * in the qbe backend.
 */

int
main(void)
{
	long long l = 1ll < 34;

	l = l + 1;

	return l == 1;
}
