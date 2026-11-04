# The current directory is the process's, whichever thread changes it.
import os, tempfile, threading

start = os.getcwd()
with tempfile.TemporaryDirectory() as top:
    top = os.path.realpath(top)
    os.mkdir(os.path.join(top, "sub"))

    def move(to):
        os.chdir(to)
        print("in the thread:", os.path.relpath(os.getcwd(), top))

    descriptor = os.open(top, os.O_RDONLY)
    for to in (top, "sub", os.fsencode(top), descriptor):
        thread = threading.Thread(target=move, args=(to,))
        thread.start()
        thread.join()
        print("in the main thread:", os.path.relpath(os.getcwd(), top), os.path.exists("sub"))
    os.close(descriptor)

    def fails():
        try:
            os.chdir("nothing here")
        except OSError as e:
            print(type(e).__name__, e.filename)

    thread = threading.Thread(target=fails)
    thread.start()
    thread.join()
    print(os.getcwd() == top)
    os.chdir(start)
