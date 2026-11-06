-- =============================================================================
-- migration_02_rls_hardening.sql
-- -----------------------------------------------------------------------------
-- WHAT THIS CHANGES (RLS stays ENABLED on every table)
--   bookings
--     1. INSERT policy: a user may only insert a booking for themselves AND
--        with status 'confirmed'.
--     2. UPDATE policy: a user may only change their OWN, currently
--        'confirmed' booking, and only into 'cancelled'.
--        (USING checks the old row, WITH CHECK checks the new row.)
--     3. Column privileges: authenticated users may UPDATE only the "status"
--        column, so room/date/time/booked_by can never be edited via the API.
--        anon gets no UPDATE at all.
--     4. DELETE and TRUNCATE are revoked from anon/authenticated. Bookings are
--        soft-cancelled, never deleted. (There was already no DELETE policy,
--        so deletes were denied; this makes it explicit.)
--   rooms, schedules
--     5. DELETE/TRUNCATE revoked from anon (RLS already denied writes).
--        Admin write policies are added in migration_03.
--
--   Unchanged on purpose: public SELECT on bookings (needed for the live
--   occupancy grid and Realtime for guests). Trade-off: booked_by UUIDs are
--   readable by anyone. See README "Future scope".
--
-- SAFE TO RE-RUN: yes (idempotent).
--
-- ROLLBACK:
--   GRANT UPDATE, DELETE, TRUNCATE ON public.bookings TO anon, authenticated;
--   GRANT DELETE, TRUNCATE ON public.rooms, public.schedules TO anon;
--   DROP POLICY IF EXISTS "Allow authenticated insert bookings" ON public.bookings;
--   CREATE POLICY "Allow authenticated insert bookings" ON public.bookings
--     FOR INSERT TO authenticated WITH CHECK (auth.uid() = booked_by);
--   DROP POLICY IF EXISTS "Allow user update own bookings" ON public.bookings;
--   CREATE POLICY "Allow user update own bookings" ON public.bookings
--     FOR UPDATE TO authenticated
--     USING (auth.uid() = booked_by) WITH CHECK (auth.uid() = booked_by);
-- =============================================================================

BEGIN;

-- Make sure RLS is on (no-op if it already is).
ALTER TABLE public.rooms     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings  ENABLE ROW LEVEL SECURITY;

-- 1. INSERT: own bookings only, always created as 'confirmed'.
DROP POLICY IF EXISTS "Allow authenticated insert bookings" ON public.bookings;
CREATE POLICY "Allow authenticated insert bookings" ON public.bookings
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = booked_by AND status = 'confirmed');

-- 2. UPDATE: only cancel your own confirmed booking.
DROP POLICY IF EXISTS "Allow user update own bookings" ON public.bookings;
CREATE POLICY "Allow user update own bookings" ON public.bookings
  FOR UPDATE TO authenticated
  USING (auth.uid() = booked_by AND status = 'confirmed')
  WITH CHECK (auth.uid() = booked_by AND status = 'cancelled');

-- 3. Column-level privilege: only "status" is updatable by API users.
REVOKE UPDATE ON public.bookings FROM anon, authenticated;
GRANT  UPDATE (status) ON public.bookings TO authenticated;

-- 4. No hard deletes of bookings from the API.
REVOKE DELETE, TRUNCATE ON public.bookings FROM anon, authenticated;

-- 5. Guests can never delete/truncate reference data.
REVOKE DELETE, TRUNCATE ON public.rooms, public.schedules FROM anon;
REVOKE TRUNCATE ON public.rooms, public.schedules FROM authenticated;

COMMIT;
