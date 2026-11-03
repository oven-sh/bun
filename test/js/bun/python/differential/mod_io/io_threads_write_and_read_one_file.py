# Threads that write to a file opened for text, while another reads from it: nothing that was written is lost.
import collections, os, tempfile, threading

def one_round(name, mode, data, writers=2, writes=100, reads=100):
    def write(file, barrier):
        barrier.wait()
        for _ in range(writes):
            file.write(data)

    def read(file, barrier):
        barrier.wait()
        for _ in range(reads):
            for line in file:
                pass

    with open(name, mode) as file:
        barrier = threading.Barrier(writers + 1)
        threads = [threading.Thread(target=write, args=(file, barrier)) for _ in range(writers)]
        threads.append(threading.Thread(target=read, args=(file, barrier)))
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
    return os.stat(name).st_size

with tempfile.TemporaryDirectory() as directory:
    name = os.path.join(directory, "file")
    for mode, data in (("w+", "x"), ("w+", "line\n"), ("w+", "€"), ("wb+", b"x")):
        print(mode, ascii(data), sorted(collections.Counter(one_round(name, mode, data) for _ in range(40)).items()))
