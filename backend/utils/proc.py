"""
Cross-platform process helpers (macOS / Windows / Linux) used by the shutdown flow.
"""

import os
import signal
import sys
from typing import Iterable, Set

import psutil


def pids_listening(port: int) -> Set[int]:
    """PIDs listening on a TCP port. Per-process scan: the global table needs root on macOS."""
    pids: Set[int] = set()
    for p in psutil.process_iter(["pid"]):
        try:
            conns = p.net_connections(kind="tcp")
        except psutil.Error:
            continue
        if any(c.status == psutil.CONN_LISTEN and c.laddr and c.laddr.port == port for c in conns):
            pids.add(p.info["pid"])
    return pids


def pids_with_cmdline(fragment: str) -> Set[int]:
    """Processes whose command line contains fragment (e.g. a dedicated --user-data-dir)."""
    found: Set[int] = set()
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


def stop_self() -> None:
    """Ask uvicorn (this process) for a graceful shutdown so lifespan cleanup runs."""
    if sys.platform == "win32":
        signal.raise_signal(signal.SIGINT)
    else:
        os.kill(os.getpid(), signal.SIGTERM)
