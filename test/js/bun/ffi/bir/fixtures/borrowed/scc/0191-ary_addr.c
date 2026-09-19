static const char *bla[] = { "a", "b" };

void
fn(const void *v)
{
}

int
main(void)
{
	fn(&bla);

	return 0;
}
