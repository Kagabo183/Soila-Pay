-- POSTGRES_DB=fineract_tenants (set in docker-compose.yml) already creates the
-- fineract_tenants database before this script runs. Postgres can't create a
-- sibling database from inside a transaction block, so fineract_default is
-- created here as a separate top-level statement instead.
CREATE DATABASE fineract_default;
