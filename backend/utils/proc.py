"""
Cross-platform process helpers (macOS / Windows / Linux) used by the shutdown flow.
"""

import os
import signal
import subprocess
import sys
import threading
from collections.abc import Iterable, Iterator

import psutil


def cpu_cores() -> tuple[int, int]:
    """(physical, logical) CPU cores."""
    logical = psutil.cpu_count() or 1
    return psutil.cpu_count(logical=False) or logical, logical


def pid_alive(pid: int) -> bool:
    return psutil.pid_exists(pid)


def pids_listening(port: int) -> set[int]:
    """PIDs listening on a TCP port. Per-process scan: the global table needs root on macOS."""
    pids: set[int] = set()
    for p in psutil.process_iter(["pid"]):
        try:
            conns = p.net_connections(kind="tcp")
        except psutil.Error:
            continue
        if any(c.status == psutil.CONN_LISTEN and c.laddr and c.laddr.port == port for c in conns):
            pids.add(p.info["pid"])
    return pids


def pids_with_cmdline(fragment: str) -> set[int]:
    """Processes whose command line contains fragment (e.g. a dedicated --user-data-dir)."""
    found: set[int] = set()
    for p in psutil.process_iter(["pid", "cmdline"]):
        cmd = p.info.get("cmdline") or []
        if any(fragment in part for part in cmd):
            found.add(p.info["pid"])
    return found


def terminate(pids: Iterable[int], timeout: float = 3.0) -> None:
    """Polite stop, then kill whatever is still alive."""
    procs = []
    for pid in set(pids) - {os.getpid()}:
        try:
            p = psutil.Process(pid)
            p.terminate()
            procs.append(p)
        except psutil.Error:
            pass
    _, alive = psutil.wait_procs(procs, timeout=timeout)
    for p in alive:
        try:
            p.kill()
        except psutil.Error:
            pass


def terminate_tree(pid: int, timeout: float = 3.0) -> None:
    """A process with everything it started (yt-dlp and its ffmpeg)."""
    try:
        children = {c.pid for c in psutil.Process(pid).children(recursive=True)}
    except psutil.Error:
        children = set()
    terminate({pid, *children}, timeout)


def stream_lines(cmd: list[str], stdin: str, cwd: str, env: dict[str, str], timeout: float) -> Iterator[str]:
    """Run cmd, write stdin and close it, yield stdout line by line. Past the timeout, or when the caller stops
    reading, the process and everything it started are stopped. Raises CalledProcessError with stderr on a non-zero
    exit and TimeoutExpired past the timeout."""
    proc = subprocess.Popen(
        cmd, cwd=cwd, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, encoding="utf-8", errors="replace",
    )
    err: list[str] = []
    reader = threading.Thread(target=lambda: err.append(proc.stderr.read()), daemon=True)  # a full stderr pipe would stall it
    reader.start()
    expired = threading.Event()

    def expire() -> None:
        expired.set()
        terminate_tree(proc.pid)

    timer = threading.Timer(timeout, expire)
    timer.start()
    finished = False
    try:
        try:
            proc.stdin.write(stdin)
            proc.stdin.close()
        except BrokenPipeError:
            pass  # it exited before reading: stderr says why
        yield from proc.stdout
        finished = True
    finally:
        timer.cancel()
        if not finished:
            terminate_tree(proc.pid)
        proc.wait()
        reader.join(1)
    if expired.is_set():
        raise subprocess.TimeoutExpired(cmd, timeout)
    if proc.returncode:
        raise subprocess.CalledProcessError(proc.returncode, cmd, stderr="".join(err))


def stop_self() -> None:
    """Ask uvicorn (this process) for a graceful shutdown so lifespan cleanup runs."""
    if sys.platform == "win32":
        signal.raise_signal(signal.SIGINT)
    else:
        os.kill(os.getpid(), signal.SIGTERM)
