from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # extra="ignore": .env also carries MYSQL_ROOT_PASSWORD, used only by
    # docker-compose to initialize the MySQL container itself, not by this app.
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    # App
    app_env: str = "local"  # local | staging | prod
    log_level: str = "INFO"
    # Comma-separated list of origins allowed to call this API from a browser
    # (the console frontend). Defaults cover the console's own local dev
    # server - override for any deployed frontend origin.
    cors_allowed_origins: str = "http://localhost:3000,http://127.0.0.1:3000"

    # Fineract
    fineract_base_url: str = "https://localhost:8443/fineract-provider/api/v1"
    fineract_tenant_id: str = "default"
    fineract_username: str = "mifos"
    fineract_password: str = "password"
    fineract_ssl_verify: bool = False  # local-dev only; self-signed cert
    fineract_payment_type_id: int = 1
    fineract_locale: str = "en"
    fineract_date_format: str = "dd MMMM yyyy"
    fineract_timeout_seconds: float = 15.0

    # Collection provider (pulls money from a customer's mobile money account)
    collection_provider_name: str = "ddin"  # "ddin" (real) | "dummy" (local/Bruno rollback testing)
    collection_dummy_base_url: str = "http://dummy-collection:9000"
    collection_timeout_seconds: float = 10.0
    collection_dummy_latency_seconds: float = 0.2

    # DDIN / Moola sandbox (Auth & Accounts + Collection API)
    ddin_base_url: str = "https://agenttestapi.ddin.rw"
    ddin_username: str = ""
    ddin_password: str = ""
    ddin_login_path: str = "/v1/agency/auth/login"
    ddin_refresh_path: str = "/v1/agency/auth/refresh-token"
    # ASSUMPTION: only the base-URL example path was provided, not the full
    # Collection API doc section - confirm this against DDIN's real docs.
    ddin_collection_path: str = "/v1/momo/collection/initiate"
    # NOT in any doc we were given - discovered empirically (confirmed live
    # 2026-08-08) by probing REST-conventional paths against the sandbox.
    # GET {this}/{referenceId} returns the real DDIN Collection record:
    # {"success": true, "data": {"status": "success"|"failed"|"pending",
    # "customerName": ..., "message": ..., "transactionId": ...,
    # "operationReferenceId": ..., ...}}. Lets us actively reconcile a
    # DEBITED (awaiting-webhook) row with DDIN's real outcome when the
    # webhook itself can't reach us (e.g. no public URL in local dev) - see
    # DDINCollectionProvider.get_status / CollectionOrchestrator.sync_with_provider.
    ddin_collection_status_path: str = "/v1/momo/collection"
    # From DDIN's "Getting Started" docs (Auth & Accounts API) - lists float
    # account balances. Used only by the connection diagnostics check (see
    # app/services/ddin_diagnostics.py), not by the collection flow itself.
    ddin_balance_path: str = "/v1/agency/accounts/all/accounts/info/balance"
    ddin_timeout_seconds: float = 15.0
    # Shared secret DDIN issues when you register a webhook subscription (not
    # the same as ddin_username/password) - used to verify X-Moola-Signature
    # on incoming collection.success/collection.failed webhooks. See
    # app/api/v1/webhooks.py.
    ddin_webhook_secret: str = ""

    # Background reconciliation (app/main.py's _reconciliation_loop): DDIN's
    # webhook can't reach a non-public URL (e.g. localhost in local dev), so
    # a DEBITED (awaiting-outcome) row can otherwise sit stale forever even
    # after DDIN itself resolved it - see
    # CollectionOrchestrator.sync_with_provider. This periodically polls
    # DDIN directly for every DEBITED row so the local record self-heals
    # without anyone needing to view/click anything. Safe to disable (e.g. to
    # avoid DDIN sandbox rate limits) - manual sync via the "Check DDIN"
    # button and auto-sync-on-view still work either way.
    collection_reconciliation_enabled: bool = True
    collection_reconciliation_interval_seconds: float = 30.0

    # Rollback retry
    refund_max_attempts: int = 5
    refund_backoff_base_seconds: float = 1.0

    # Transient-failure retry for outbound DDIN calls (login/refresh/collect) -
    # timeouts, connection errors, and 5xx only. Never retries 401/403 or
    # other 4xx (those are handled by the refresh-and-retry-once flow, or are
    # genuine business rejections that won't succeed on retry).
    ddin_retry_max_attempts: int = 3
    ddin_retry_backoff_base_seconds: float = 0.5

    # Integrator self-service portal (signup/login session tokens - see
    # app/services/integrator_auth.py). MUST be overridden in .env for any
    # shared/production deployment - main.py warns loudly if it isn't.
    integrator_session_secret: str = "insecure-dev-secret-change-me"

    # Operator/admin auth for /api/v1/admin/* (integrator CRUD, DDIN
    # diagnostics, revenue summary). A single shared operator credential, not
    # a per-admin user table - deliberately simple for this stage; see the
    # README's "Known gap" note on multi-admin support. Empty by default so
    # admin auth FAILS CLOSED (nobody can log in) rather than failing open
    # with a guessable default credential.
    admin_username: str = ""
    admin_password: str = ""
    admin_session_secret: str = "insecure-dev-secret-change-me"

    # In-memory rate limit for endpoints that make real outbound calls to
    # DDIN (diagnostics) - per-process, not shared across replicas. See the
    # README's "Known gap" note if this ever runs behind multiple instances.
    ddin_diagnostics_rate_limit_per_minute: int = 10

    # MySQL
    mysql_host: str = "mysql"
    mysql_port: int = 3306
    mysql_user: str = "soila_app"
    mysql_password: str = "changeme"
    mysql_db: str = "soila_pay"
    mysql_pool_min_size: int = 1
    mysql_pool_max_size: int = 10


settings = Settings()
