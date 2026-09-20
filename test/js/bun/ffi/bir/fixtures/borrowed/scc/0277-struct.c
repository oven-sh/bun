struct S {
        int a;
        int b;
};
struct S s = { 0, 1 };
int arr[2] = { 0, 1 };

int
main (void)
{
	return arr[s.a++];
}
