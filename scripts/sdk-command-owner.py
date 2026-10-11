"""Private Linux SDK owner: FD3 receipts, FD4 cancellation; neither is inherited."""
import ctypes
import json
import os
import signal
import subprocess
import sys
import time


def emit(row):
    raw = (json.dumps(row, separators=(",", ":")) + "\n").encode("ascii")
    if len(raw) > 1024:
        raise RuntimeError("protocol bound")
    while raw:
        count = os.write(3, raw)
        if count <= 0:
            raise RuntimeError("protocol write")
        raw = raw[count:]


class Owner:
    def __init__(self, profile):
        if profile not in ("vv", "qualification"):
            raise RuntimeError("profile")
        self.profile = profile
        self.process = None
        self.known = set()
        self.termed = set()
        self.leader = None
        self.stopping = None
        self.orphaned = False
        self.error = None
        self.cleaned = False
        self.child_path = f"/proc/self/task/{os.getpid()}/children"

    def stop(self, _signum=None, _frame=None):
        if self.stopping is None:
            self.stopping = time.monotonic()
            self.orphaned = self.leader is not None and not self.cleaned

    def interrupted(self, _signum, _frame):
        self.error = self.error or "supervisor-interrupted"
        self.stop()

    def discover(self):
        fd = os.open(self.child_path, os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW)
        try:
            raw = b""
            while len(raw) <= 65536:
                part = os.read(fd, min(4096, 65537 - len(raw)))
                if not part:
                    break
                raw += part
        finally:
            os.close(fd)
        tokens = raw.split()
        if len(raw) > 65536 or len(tokens) > 4096 or any(not token.isdigit() for token in tokens):
            raise RuntimeError("children bound or identity")
        self.known.update(int(token) for token in tokens)

    def reap(self):
        # The sole waiter retains unreaped ownership. A bounded scheduler pass
        # is NOT exhaustion; only ECHILD can authorize descendants_absent.
        for _ in range(4096):
            try:
                pid, status = os.waitpid(-1, os.WNOHANG)
            except ChildProcessError:
                self.cleaned = True
                return
            if pid == 0:
                return
            self.known.discard(pid)
            self.termed.discard(pid)
            if pid == self.process.pid:
                self.process.returncode = os.waitstatus_to_exitcode(status)
                self.leader = {
                    "status": os.WEXITSTATUS(status) if os.WIFEXITED(status) else None,
                    "signal": signal.Signals(os.WTERMSIG(status)).name if os.WIFSIGNALED(status) else None,
                }
                emit({"event": "leader-exited", **self.leader})

    def signal_owned(self):
        for pid in tuple(self.known):
            try:
                state = os.waitid(os.P_PID, pid, os.WEXITED | os.WNOHANG | os.WNOWAIT)
                if state is not None:
                    continue
                if self.profile == "vv" or time.monotonic() >= self.stopping + 4:
                    signum = signal.SIGKILL
                elif pid not in self.termed:
                    signum = signal.SIGTERM
                    self.termed.add(pid)
                else:
                    continue
                # killpg is permitted only for our still-unreaped original
                # session leader. After reaping, its numeric PGID is never used.
                if pid == self.process.pid:
                    os.killpg(pid, signum)
                else:
                    os.kill(pid, signum)
            except ChildProcessError:
                self.error = self.error or "ownership"
            except ProcessLookupError:
                pass
            except OSError:
                self.error = self.error or "signal"

    def control(self):
        try:
            raw = os.read(4, 2)
        except BlockingIOError:
            return
        if raw != b"S" and raw != b"":
            self.error = self.error or "control"
        # EOF is loss of the parent, not successful completion.
        if raw == b"":
            self.error = self.error or "parent-channel"
        self.stop()

    def run(self, command):
        if sys.platform != "linux" or sys.version_info[:3] not in ((3, 11, 2), (3, 12, 3)):
            raise RuntimeError("interpreter admission")
        if signal.getsignal(signal.SIGCHLD) != signal.SIG_DFL:
            raise RuntimeError("exclusive waiter admission")
        os.set_inheritable(3, False)
        os.set_inheritable(4, False)
        os.set_blocking(4, False)
        for signum in (signal.SIGHUP, signal.SIGINT, signal.SIGTERM):
            signal.signal(signum, self.interrupted)
        libc = ctypes.CDLL(None, use_errno=True)
        if libc.prctl(36, 1, 0, 0, 0) != 0:
            raise RuntimeError("subreaper unavailable")
        self.discover()  # Admit the observer BEFORE command execution.
        try:
            self.control()
            if self.stopping is not None:
                raise RuntimeError("cancelled before spawn")
            self.process = subprocess.Popen(command, start_new_session=True, close_fds=True)
            self.known.add(self.process.pid)
            emit({"event": "started", "pid": self.process.pid,
                  "python_version": ".".join(map(str, sys.version_info[:3]))})
        except Exception:
            self.error = self.error or "supervision"
            self.stop()
        if self.process is not None:
            while not self.cleaned:
                try:
                    self.control()
                    self.reap()
                except Exception:
                    self.error = self.error or "supervision"
                    self.stop()
                if self.cleaned:
                    break
                if self.stopping is not None:
                    try:
                        self.discover()
                    except Exception:
                        self.error = self.error or "observation"
                    self.signal_owned()
                    if time.monotonic() >= self.stopping + 5:
                        self.error = self.error or "retirement"
                        break
                # Natural descendants may complete within the ORIGINAL Node
                # command deadline. No extra trailing-work grace is introduced.
                time.sleep(0.005)
        emit({"event": "completed", **(self.leader or {"status": None, "signal": None}),
              "descendants_absent": self.cleaned, "orphaned": self.orphaned, "error": self.error})
        return 0 if self.cleaned and self.leader is not None and self.error is None else 125


if __name__ == "__main__":
    try:
        sys.exit(Owner(sys.argv[1]).run(sys.argv[2:]))
    except Exception:
        try:
            emit({"event": "failed", "error": "admission-or-protocol"})
        except Exception:
            pass
        sys.exit(125)
