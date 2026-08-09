"""
Deploy Soila-Pay updates to VPS.
Assumes setup_vps.py has already been run once.
"""
import paramiko, sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('vlearn.velotafrica.com', username='root', password='EgL2j53mJ7yxWgK24V', timeout=20)

def run(cmd, timeout=120, label=None):
    if label:
        print(f"\n{'='*50}")
        print(f"  {label}")
        print('='*50)
    _, out, _ = client.exec_command(cmd, timeout=timeout, get_pty=True)
    while True:
        line = out.readline()
        if not line:
            break
        print(line, end='', flush=True)

run('cd /var/www/soila-pay && git stash && git pull origin main 2>&1', label='git pull')
run('cd /var/www/soila-pay && docker compose build 2>&1', timeout=600, label='docker build')
run('cd /var/www/soila-pay && docker compose up -d 2>&1', timeout=60, label='docker compose up')
run('cd /var/www/soila-pay && docker compose ps 2>&1', timeout=15, label='status')

print("\n=== DONE ===")
client.close()
