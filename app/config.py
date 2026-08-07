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

    # Utility provider
    utility_provider_name: str = "ddin"  # "ddin" (real) | "dummy" (local/Bruno rollback testing)
    utility_dummy_base_url: str = "http://dummy-utility:9000"
    utility_timeout_seconds: float = 10.0
    utility_dummy_latency_seconds: float = 0.2

    # DDIN / Moola sandbox (Auth & Accounts + Collection API)
    ddin_base_url: str = "https://agenttestapi.ddin.rw"
    ddin_username: str = ""
    ddin_password: str = ""
    ddin_login_path: str = "/v1/agency/auth/login"
    ddin_refresh_path: str = "/v1/agency/auth/refresh-token"
    # ASSUMPTION: only the base-URL example path was provided, not the full
    # Collection API doc section - confirm this against DDIN's real docs.
    ddin_collection_path: str = "/v1/momo/collection/initiate"
    ddin_timeout_seconds: float = 15.0

    # Rollback retry
    refund_max_attempts: int = 5
    refund_backoff_base_seconds: float = 1.0

    # MySQL
    mysql_host: str = "mysql"
    mysql_port: int = 3306
    mysql_user: str = "soila_app"
    mysql_password: str = "changeme"
    mysql_db: str = "soila_pay"
    mysql_pool_min_size: int = 1
    mysql_pool_max_size: int = 10


settings = Settings()
