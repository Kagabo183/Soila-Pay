"""
Create the Soila-Pay MySQL database/user and apply db_init/*.sql migrations.

Replaces what the MySQL Docker image used to do automatically on first boot.
Safe to re-run: each file is recorded in a `schema_migrations` table and only
applied once.

Usage (from the repo root, with .env filled in):
    python scripts/init_db.py

Needs MYSQL_ROOT_PASSWORD (or an admin user via MYSQL_ADMIN_USER /
MYSQL_ADMIN_PASSWORD) to create the database and app user. If the database and
user already exist (e.g. a hosted MySQL), leave MYSQL_ROOT_PASSWORD empty and
the script connects as MYSQL_USER instead and only applies migrations.
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path

import pymysql
from pymysql.constants import CLIENT

ROOT = Path(__file__).resolve().parent.parent
MIGRATIONS_DIR = ROOT / "db_init"

# Migrations that only upgrade databases created before 001_schema.sql was
# rewritten. On a fresh install 001 already creates the new columns, so these
# would fail - skip them when (table, column) already exists.
SKIP_IF = {
    "007_align_transaction_logs_columns.sql": ("transaction_logs", "customer_name"),
}


def _column_exists(conn, db: str, table: str, column: str) -> bool:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT 1 FROM information_schema.COLUMNS"
            " WHERE TABLE_SCHEMA=%s AND TABLE_NAME=%s AND COLUMN_NAME=%s",
            (db, table, column),
        )
        return cur.fetchone() is not None


def load_env(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


def main() -> int:
    load_env(ROOT / ".env")

    host = os.environ.get("MYSQL_HOST", "localhost")
    port = int(os.environ.get("MYSQL_PORT", "3306"))
    db = os.environ.get("MYSQL_DB", "soila_pay")
    app_user = os.environ.get("MYSQL_USER", "soila_app")
    app_password = os.environ.get("MYSQL_PASSWORD", "")
    admin_user = os.environ.get("MYSQL_ADMIN_USER", "root")
    admin_password = os.environ.get("MYSQL_ADMIN_PASSWORD") or os.environ.get("MYSQL_ROOT_PASSWORD", "")

    if not re.fullmatch(r"[A-Za-z0-9_]+", db) or not re.fullmatch(r"[A-Za-z0-9_]+", app_user):
        print("MYSQL_DB and MYSQL_USER may only contain letters, digits and underscores.")
        return 1

    if admin_password:
        print(f"Connecting to {host}:{port} as {admin_user} to create database/user...")
        conn = pymysql.connect(host=host, port=port, user=admin_user, password=admin_password,
                               client_flag=CLIENT.MULTI_STATEMENTS, autocommit=True)
        with conn.cursor() as cur:
            cur.execute(f"CREATE DATABASE IF NOT EXISTS `{db}` CHARACTER SET utf8mb4")
            for user_host in ("localhost", "%"):
                # "%%" because these queries take parameters (PyMySQL %-formats them).
                escaped_host = user_host.replace("%", "%%")
                cur.execute(f"CREATE USER IF NOT EXISTS '{app_user}'@'{escaped_host}' IDENTIFIED BY %s",
                            (app_password,))
                cur.execute(f"ALTER USER '{app_user}'@'{escaped_host}' IDENTIFIED BY %s", (app_password,))
                cur.execute(f"GRANT ALL PRIVILEGES ON `{db}`.* TO '{app_user}'@'{user_host}'")
            cur.execute("FLUSH PRIVILEGES")
    else:
        print(f"No admin password set - connecting to {host}:{port} as {app_user} (database must already exist)...")
        conn = pymysql.connect(host=host, port=port, user=app_user, password=app_password,
                               client_flag=CLIENT.MULTI_STATEMENTS, autocommit=True)

    with conn.cursor() as cur:
        cur.execute(f"USE `{db}`")
        cur.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations ("
            " filename VARCHAR(191) PRIMARY KEY,"
            " applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)"
        )
        cur.execute("SELECT filename FROM schema_migrations")
        applied = {row[0] for row in cur.fetchall()}

    files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    pending = [f for f in files if f.name not in applied]
    if not pending:
        print("Database is up to date.")
        return 0

    for f in pending:
        if f.name in SKIP_IF and _column_exists(conn, db, *SKIP_IF[f.name]):
            print(f"Skipping {f.name} (schema already has the columns it adds)")
            with conn.cursor() as cur:
                cur.execute(f"USE `{db}`")
                cur.execute("INSERT INTO schema_migrations (filename) VALUES (%s)", (f.name,))
            continue
        sql = f.read_text(encoding="utf-8")
        # The SQL files hardcode `soila_pay`; honour a custom MYSQL_DB name.
        if db != "soila_pay":
            sql = re.sub(r"\bsoila_pay\b", db, sql)
        print(f"Applying {f.name} ...")
        with conn.cursor() as cur:
            cur.execute(f"USE `{db}`")
            cur.execute(sql)
            while cur.nextset():
                pass
            cur.execute(f"USE `{db}`")
            cur.execute("INSERT INTO schema_migrations (filename) VALUES (%s)", (f.name,))

    conn.close()
    print(f"Applied {len(pending)} migration(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
