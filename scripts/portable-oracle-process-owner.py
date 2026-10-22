"""Linux-only test owner; reap even descendants that detach into new sessions."""
import ctypes
import json
import os
import signal
import subprocess
import sys
import time


def children():
    with open(f"/proc/self/task/{os.getpid()}/children", encoding="ascii") as stream:
        return [int(value) for value in stream.read().split()]


def main():
    seconds, receipt, *command = sys.argv[1:]
    limit = float(seconds)
    if not command or not 0 < limit <= 900:
        raise ValueError("invalid bounded command")
    if ctypes.CDLL(None, use_errno=True).prctl(36, 1, 0, 0, 0) != 0:
        raise RuntimeError("subreaper unavailable")
    interrupted = False

    def stop(_signum, _frame):
        nonlocal interrupted
        interrupted = True

    for signum in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(signum, stop)
    process = None
    code = None
    timed_out = False
    cleaned = False
    try:
        process = subprocess.Popen(command, start_new_session=True)
        deadline = time.monotonic() + limit
        while (code := process.poll()) is None:
            if interrupted or time.monotonic() >= deadline:
                timed_out = not interrupted
                break
            time.sleep(0.01)
    finally:
        # Killing direct children repeatedly causes detached grandchildren to
        # be adopted here. An empty /proc children list after waitpid is the
        # cleanup evidence; killing a process group alone is not evidence.
        deadline = time.monotonic() + 5
        while True:
            if process is not None:
                process.poll()
            for pid in children():
                try:
                    os.kill(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            while True:
                try:
                    pid, _ = os.waitpid(-1, os.WNOHANG)
                    if not pid:
                        break
                except ChildProcessError:
                    break
            if not children():
                cleaned = True
                break
            if time.monotonic() >= deadline:
                break
            time.sleep(0.005)
        with open(receipt, "x", encoding="utf-8") as stream:
            json.dump({"schema": "prismpm/portable-process-owner/1", "exit_code": code,
                       "timed_out": timed_out, "interrupted": interrupted,
                       "cleanup_verified": cleaned}, stream)
    return 125 if not cleaned or interrupted else 124 if timed_out else code


if __name__ == "__main__":
    sys.exit(main())
