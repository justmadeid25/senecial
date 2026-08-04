-- Runs once, on first initialization of the postgres container's data
-- volume. Creates a separate database for integration tests so they never
-- run against the main development database.
CREATE DATABASE clausebase_test OWNER clausebase;
