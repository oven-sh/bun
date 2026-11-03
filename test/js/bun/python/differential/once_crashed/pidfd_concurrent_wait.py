# test_asyncio.test_subprocess.SubprocessPidfdWatcherTests.test_subprocess_concurrent_wait: abort()
import asyncio, subprocess, sys
async def main():
    proc = await asyncio.create_subprocess_exec(sys.executable, "-c", "import sys; sys.stdout.buffer.write(sys.stdin.buffer.read())", stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    stdout, _ = await proc.communicate(b"some data")
    print(stdout, proc.returncode, await asyncio.gather(*[proc.wait() for _ in range(10)]))
for _ in range(20):
    asyncio.run(main())
