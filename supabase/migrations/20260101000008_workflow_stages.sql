-- =============================================================================
-- Flash Pilot - production lifecycle, part 1: the stage names
--
-- New lifecycle:
--   upcoming -> production -> awaiting_approval -> editing -> out_for_delivery -> delivered
--
--   * awaiting_approval ("Waiting for Client Approval") is new: the shoot is over and the
--     studio is waiting for the client to approve before editing starts.
--   * ready_for_delivery is renamed out_for_delivery. It is the same point in the flow
--     (editing finished, handing the work over), so existing rows move across with no
--     data change.
--
-- This file contains ONLY the enum change. Postgres does not allow a freshly added enum
-- value to be used in the transaction that added it, so everything that uses the new
-- values lives in 20260101000009_event_lifecycle.sql, which runs as its own transaction.
-- =============================================================================

alter type public.production_stage rename value 'ready_for_delivery' to 'out_for_delivery';
alter type public.production_stage add value if not exists 'awaiting_approval' before 'editing';
