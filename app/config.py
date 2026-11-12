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
    # https variants: `npm run dev:https` (browsers only autofill card forms
    # on https pages, even inside an embedded payment iframe).
    cors_allowed_origins: str = "http://localhost:3000,http://127.0.0.1:3000,https://localhost:3000,https://127.0.0.1:3000"

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

    # LMBTech payment gateway - MTN MoMo + card (Visa/Mastercard via Pesapal).
    # Basic auth = base64(app_key:secret_key). The test keys from LMBTech's
    # public docs are the defaults in .env.example; swap for live keys.
    lmbtech_base_url: str = "https://pay.lmbtech.rw/pay/config/api.php"
    lmbtech_app_key: str = ""
    lmbtech_secret_key: str = ""
    # Email of the Soila Pay merchant account at LMBTech. Their payout API
    # (action=payout) expects the account's OWN email in the `email` field.
    lmbtech_account_email: str = ""
    # True while using LMBTech's test keys - marks payments as test in the UI.
    lmbtech_test_mode: bool = True
    # LMBTech holds a MoMo request open while the customer approves on their
    # phone (observed >40s live). We don't make the caller wait for that: past
    # this timeout the payment is treated as PENDING and resolved by polling.
    lmbtech_timeout_seconds: float = 20.0
    # Public URL of THIS API, used to build the callback_url LMBTech posts to.
    # localhost works for local dev only via polling (LMBTech can't reach it).
    public_api_base_url: str = "http://localhost:8000"
    # Public URL of the web app - card payers land on {this}/pay/return.
    frontend_base_url: str = "http://localhost:3000"
    # Shared hosting only (passenger_wsgi.py): folder with the exported
    # frontend, served for every path outside /api when the app is mounted
    # at the site root. Empty = the web server serves the frontend itself.
    static_site_dir: str = ""
    # Background poll of PENDING payments (covers callbacks that never arrive).
    payment_reconciliation_enabled: bool = True
    payment_reconciliation_interval_seconds: float = 20.0
    # Stop polling a payment that's still PENDING after this long.
    payment_reconciliation_max_age_hours: int = 24

    # Go live without waiting for an admin: once an integrator has passed its
    # sandbox tests (a successful test card + test MoMo payment) and uploaded
    # its documents, "Go live" switches it to Production and issues its live
    # key at once. False = the old manual review (admin approves). Admins can
    # always revoke an account later.
    integrator_auto_go_live: bool = True

    # Integrator self-service portal (signup/login session tokens - see
    # app/services/integrator_auth.py). MUST be overridden in .env for any
    # shared/production deployment - main.py warns loudly if it isn't.
    integrator_session_secret: str = "insecure-dev-secret-change-me"

    # Operator/admin auth for /api/v1/admin/* (integrators, pricing, payments
    # and payouts, revenue summary). A single shared operator credential, not
    # a per-admin user table - deliberately simple for this stage; see the
    # README's "Known gap" note on multi-admin support. Empty by default so
    # admin auth FAILS CLOSED (nobody can log in) rather than failing open
    # with a guessable default credential.
    admin_username: str = ""
    admin_password: str = ""
    admin_session_secret: str = "insecure-dev-secret-change-me"

    # MySQL
    mysql_host: str = "mysql"
    mysql_port: int = 3306
    mysql_user: str = "soila_app"
    mysql_password: str = "changeme"
    mysql_db: str = "soila_pay"
    mysql_pool_min_size: int = 1
    mysql_pool_max_size: int = 10


settings = Settings()
