int main()
{
	for (struct {enum {A, B} a;} a = {0}; 0;)
		;

	return 0;
}
