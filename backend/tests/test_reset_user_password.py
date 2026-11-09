"""Password reset must not take the password from argv.

Run: cd backend && python3 -m pytest tests/test_reset_user_password.py -q
"""
from __future__ import annotations

import io
import re
import subprocess
import sys
from pathlib import Path

import pytest

import reset_user_password as reset


class _Tty(io.StringIO):
    def isatty(self) -> bool:
        return True


def test_interactive_getpass_does_not_read_stdin():
    stream = _Tty("ignored-stdin\n")
    seen = []

    def fake_getpass(prompt: str) -> str:
        seen.append(prompt)
        return "test123"

    assert reset.read_password(from_stdin=False, stdin=stream, getpass_func=fake_getpass) == "test123"
    assert seen == ["Password: "]
    assert stream.readline() == "ignored-stdin\n"


def test_getpass_refuses_empty_and_blank():
    def blank(_prompt: str) -> str:
        return "   "

    with pytest.raises(SystemExit, match="empty"):
        reset.read_password(from_stdin=False, stdin=_Tty(), getpass_func=lambda _p: "")
    with pytest.raises(SystemExit, match="empty"):
        reset.read_password(from_stdin=False, stdin=_Tty(), getpass_func=blank)


def test_password_stdin_reads_one_line_and_keeps_spaces():
    assert reset.read_password(from_stdin=True, stdin=io.StringIO("test123\n")) == "test123"
    assert reset.read_password(from_stdin=True, stdin=io.StringIO("  test123  \n")) == "  test123  "
    assert reset.read_password(from_stdin=True, stdin=io.StringIO("test123\r\nextra\n")) == "test123"


def test_piped_stdin_without_flag_reads_one_line():
    assert reset.read_password(from_stdin=False, stdin=io.StringIO("test123\n")) == "test123"


def test_stdin_refuses_empty_blank_and_eof():
    for payload in ("", "\n", "\r\n", "   \n"):
        with pytest.raises(SystemExit, match="empty"):
            reset.read_password(from_stdin=True, stdin=io.StringIO(payload))


def test_parser_keeps_email_and_name_and_rejects_password_flag():
    args = reset.parse_args(["--email", "user@example.com", "--name", "Ada", "--password-stdin"])
    assert args.email == "user@example.com"
    assert args.name == "Ada"
    assert args.password_stdin is True
    dests = {action.dest for action in reset.build_parser()._actions}
    assert {"email", "name", "password_stdin"} <= dests
    assert "password" not in dests
    with pytest.raises(SystemExit):
        reset.parse_args(["--email", "user@example.com", "--password", "test123"])


def test_usage_uses_placeholders_and_has_no_password_option():
    source = Path(reset.__file__).read_text(encoding="utf-8")
    assert "user@example.com" in source
    assert "your-password-here" in source
    assert re.search(r"--password(?![\w-])", source) is None


def test_cli_help_and_stdin_refusal_do_not_open_a_database():
    script = Path(reset.__file__)
    help_proc = subprocess.run(
        [sys.executable, str(script), "--help"],
        capture_output=True,
        text=True,
        check=False,
    )
    assert help_proc.returncode == 0
    assert "--email" in help_proc.stdout
    assert "--name" in help_proc.stdout
    assert "--password-stdin" in help_proc.stdout
    assert re.search(r"--password(?![\w-])", help_proc.stdout) is None

    empty = subprocess.run(
        [sys.executable, str(script), "--email", "user@example.com", "--password-stdin"],
        input="\n",
        capture_output=True,
        text=True,
        check=False,
    )
    assert empty.returncode != 0
    assert "empty" in (empty.stderr + empty.stdout).lower()
    assert "mongo" not in (empty.stderr + empty.stdout).lower()

    rejected = subprocess.run(
        [sys.executable, str(script), "--email", "user@example.com", "--password", "test123"],
        capture_output=True,
        text=True,
        check=False,
    )
    assert rejected.returncode != 0
