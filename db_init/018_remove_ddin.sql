USE soila_pay;

-- DDIN is gone: Soila Pay collects and pays out only through LMBTech now
-- (the `payments` table). Drop what was left of the DDIN era - both tables
-- were unused by the application (and empty) when this was written.
--   ddin_diagnostics_runs : history for the old DDIN Diagnostics page (006)
--   transaction_logs      : the old Fineract debit -> DDIN collection -> refund log (001)
DROP TABLE IF EXISTS ddin_diagnostics_runs;
DROP TABLE IF EXISTS transaction_logs;
