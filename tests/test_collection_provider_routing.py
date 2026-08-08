from app.api.v1.collection import should_use_real_provider


def test_production_key_always_uses_real_provider():
    integrator = {"key_mode": "production", "sandbox_uses_real_provider": False}
    assert should_use_real_provider(integrator) is True


def test_sandbox_key_uses_dummy_provider_by_default():
    integrator = {"key_mode": "sandbox", "sandbox_uses_real_provider": False}
    assert should_use_real_provider(integrator) is False


def test_sandbox_key_uses_real_provider_when_flag_set():
    """The per-integrator override (e.g. Soila Pay's own house account) - a DB
    row flag, not a hardcoded name/ID check."""
    integrator = {"key_mode": "sandbox", "sandbox_uses_real_provider": True}
    assert should_use_real_provider(integrator) is True


def test_flag_stored_as_mysql_tinyint_int_still_works():
    """aiomysql returns TINYINT(1) as a Python int (0/1), not a bool - the
    routing check must handle both."""
    integrator_on = {"key_mode": "sandbox", "sandbox_uses_real_provider": 1}
    integrator_off = {"key_mode": "sandbox", "sandbox_uses_real_provider": 0}
    assert should_use_real_provider(integrator_on) is True
    assert should_use_real_provider(integrator_off) is False
