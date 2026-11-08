"""
Deploy Soila-Pay updates to a plain Linux server (no Docker).

Expects the server to already have: the repo cloned at DEPLOY_PATH, a
Python venv at DEPLOY_PATH/.venv, Node.js, MySQL, nginx, and the systemd units
from deploy/ installed. See "Deploying to a server" in README.md.

Credentials come from environment variables - never hardcode them here:
    DEPLOY_HOST       e.g. pay.soila.rw
    DEPLOY_USER       default: root
    DEPLOY_KEY_FILE   path to an SSH private key (preferred), or
    DEPLOY_PASSWORD   SSH password
    DEPLOY_PATH       default: /var/www/soila-pay
"""
import os
import sys

import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

host = os.environ.get("DEPLOY_HOST")
if not host:
    sys.exit("Set DEPLOY_HOST (and DEPLOY_KEY_FILE or DEPLOY_PASSWORD) before deploying.")
user = os.environ.get("DEPLOY_USER", "root")
key_file = os.environ.get("DEPLOY_KEY_FILE")
password = os.environ.get("DEPLOY_PASSWORD")
path = os.environ.get("DEPLOY_PATH", "/var/www/soila-pay")

client = paramiko.SSHClient()
client.load_system_host_keys()
client.set_missing_host_key_policy(paramiko.RejectPolicy())
client.connect(host, username=user, key_filename=key_file, password=password, timeout=20)


def run(cmd, timeout=120, label=None):
    if label:
        print(f"\n{'=' * 50}\n  {label}\n{'=' * 50}")
    _, out, _ = client.exec_command(f"cd {path} && {cmd}", timeout=timeout, get_pty=True)
    for line in iter(out.readline, ""):
        print(line, end="", flush=True)
    status = out.channel.recv_exit_status()
    if status != 0:
        client.close()
        sys.exit(f"\n'{label or cmd}' failed with exit code {status}")


run("git fetch origin && git reset --hard origin/main 2>&1", label="git pull")
run(".venv/bin/pip install -q -r requirements.txt 2>&1", timeout=600, label="backend dependencies")
run(".venv/bin/python scripts/init_db.py 2>&1", label="database migrations")
run("cd frontend && npm ci 2>&1 && npm run build 2>&1", timeout=900, label="frontend build")
run("systemctl restart soila-pay-api soila-pay-web 2>&1", label="restart services")
run("systemctl --no-pager --lines=0 status soila-pay-api soila-pay-web 2>&1", label="status")

print("\n=== DONE ===")
client.close()
