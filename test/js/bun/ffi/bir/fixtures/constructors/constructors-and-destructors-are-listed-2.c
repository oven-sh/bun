int seen = -1; __attribute__((constructor)) static int with_args(int argc, char **argv, char **envp) { seen = argc + (argv != 0) + (envp != 0); return 5; }
         int main(void) { return seen; }
