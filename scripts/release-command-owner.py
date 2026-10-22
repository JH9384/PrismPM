"""Private Linux command owner. FD 3 is not inherited by the real command."""
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
        raise RuntimeError("owner protocol bound")
    while raw:
        count = os.write(3, raw)
        if count <= 0:
            raise RuntimeError("owner protocol write")
        raw = raw[count:]


class Owner:
    def __init__(self):
        self.process = None
        self.known = set()
        self.termed = set()
        self.leader_status = None
        self.leader_finished = None
        self.stopping = None
        self.orphaned = False
        self.error = None
        self.cleaned = False
        self.child_path = f"/proc/self/task/{os.getpid()}/children"

    def stop(self, _signum=None, _frame=None):
        if self.stopping is None:
            self.stopping = time.monotonic()

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
        if len(raw) > 65536:
            raise RuntimeError("children bound")
        tokens = raw.split()
        if len(tokens) > 4096 or any(not token.isdigit() for token in tokens):
            raise RuntimeError("children identity")
        self.known.update(int(token) for token in tokens)

    def reap(self):
        # No other thread or signal handler reaps. ECHILD, not a /proc
        # snapshot, proves that adopted descendants are completely retired.
        # Bound one scheduler pass, not the total accepted process tree.
        # A continuing fork/exit stream must not starve cancellation/signals.
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
                self.leader_status = status
                self.process.returncode = os.waitstatus_to_exitcode(status)
                self.leader_finished = time.monotonic()

    def signal_owned(self):
        # Only direct, unreaped children may be signaled. Their PIDs
        # cannot be reused before this single owner calls waitpid.
        for pid in tuple(self.known):
            try:
                state = os.waitid(os.P_PID, pid, os.WEXITED | os.WNOHANG | os.WNOWAIT)
                if state is not None:
                    continue
                if time.monotonic() >= self.stopping + 5:
                    signum = signal.SIGKILL
                elif pid not in self.termed:
                    signum = signal.SIGTERM
                    self.termed.add(pid)
                else:
                    continue
                # The original command is an unreaped session leader: its
                # SID/PGID cannot change or be reused while we own this PID.
                # Preserve TERM delivery to its entire original group.
                # Adopted escaped sessions retain the same global deadline;
                # no new per-descendant grace or unlimited cleanup is claimed.
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

    def retire(self):
        self.stop()
        while not self.cleaned:
            try:
                self.reap()
            except Exception:
                self.error = self.error or "supervision"
            if self.cleaned:
                break
            try:
                self.discover()
            except Exception:
                self.error = self.error or "observation"
            # Enumeration failure cannot suppress escalation for a child
            # whose unreaped ownership was already established.
            self.signal_owned()
            if time.monotonic() >= self.stopping + 6:
                self.error = self.error or "retirement"
                break
            time.sleep(0.005)

    def run(self, command):
        for signum in (signal.SIGHUP, signal.SIGINT, signal.SIGTERM):
            signal.signal(signum, self.stop)
        if ctypes.CDLL(None, use_errno=True).prctl(36, 1, 0, 0, 0) != 0:
            raise RuntimeError("subreaper unavailable")
        self.discover()  # Admit ownership before starting application work.
        try:
            self.process = subprocess.Popen(command, start_new_session=True, close_fds=True)
            self.known.add(self.process.pid)
            emit({"event": "started", "pid": self.process.pid})
            while True:
                self.reap()
                if self.cleaned:
                    break
                if self.stopping is not None:
                    break
                if self.leader_finished is not None and time.monotonic() >= self.leader_finished + 5:
                    self.orphaned = True
                    self.stop()
                    break
                time.sleep(0.005)
        except Exception:
            self.error = self.error or "supervision"
        finally:
            if self.process is not None and not self.cleaned:
                self.retire()
        status = os.WEXITSTATUS(self.leader_status) if self.leader_status is not None and os.WIFEXITED(self.leader_status) else None
        signame = signal.Signals(os.WTERMSIG(self.leader_status)).name if self.leader_status is not None and os.WIFSIGNALED(self.leader_status) else None
        emit({"event": "completed", "status": status, "signal": signame,
              "orphaned": self.orphaned, "cleanup_verified": self.cleaned, "error": self.error})
        return 0 if self.cleaned and self.error is None else 125


if __name__ == "__main__":
    try:
        sys.exit(Owner().run(sys.argv[1:]))
    except Exception:
        # Reporting loss never mixes a traceback into original stderr.
        try:
            emit({"event": "failed", "error": "supervision"})
        except Exception:
            pass
        sys.exit(125)
