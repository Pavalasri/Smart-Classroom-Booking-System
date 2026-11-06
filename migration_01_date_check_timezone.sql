-- =============================================================================
-- migration_01_date_check_timezone.sql
-- -----------------------------------------------------------------------------
-- WHAT THIS CHANGES
--   1. Drops the column CHECK (date >= CURRENT_DATE) on bookings.
--      A CHECK is re-evaluated on every UPDATE, so cancelling a booking whose
--      date is already in the past failed with a constraint violation.
--   2. Rewrites check_booking_overlap() (the function behind the existing
--      trigger trg_check_booking_overlap). The overlap rules are unchanged;
--      it now also:
--        a. takes a transaction-level advisory lock per (room, date) so two
--           concurrent inserts for the same room/day are serialised and the
--           second one sees the first (fixes the race condition);
--        b. rejects bookings in the past on INSERT only, where "today" is
--           calculated in Asia/Kolkata, not UTC;
--        c. runs as SECURITY DEFINER with a fixed search_path so it always
--           sees every booking, regardless of the caller's RLS visibility.
--   3. Re-creates trigger trg_check_booking_overlap (BEFORE INSERT OR UPDATE).
--
-- SAFE TO RE-RUN: yes (idempotent).
--
-- ROLLBACK (restores the original behaviour, including the UPDATE bug):
--   ALTER TABLE bookings ADD CONSTRAINT bookings_date_check CHECK (date >= CURRENT_DATE) NOT VALID;
--   -- then re-run section "4. Overlap Check Trigger function" of the ORIGINAL
--   -- schema.sql (git show db00ad1:schema.sql) to restore the old function.
-- =============================================================================

BEGIN;

-- 1. Drop any CHECK constraint on bookings that references CURRENT_DATE.
--    (Postgres auto-named the inline constraint, usually "bookings_date_check",
--    so we look it up instead of hard-coding the name.)
DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.bookings'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%CURRENT_DATE%'
  LOOP
    EXECUTE format('ALTER TABLE public.bookings DROP CONSTRAINT %I', c.conname);
    RAISE NOTICE 'Dropped constraint %', c.conname;
  END LOOP;
END $$;

-- 2. Replace the trigger function.
CREATE OR REPLACE FUNCTION public.check_booking_overlap()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  has_schedule_overlap BOOLEAN;
  has_booking_overlap  BOOLEAN;
  booking_dow          INT;
  today_ist            DATE := (now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  -- a. Serialise writes for the same room + date. The lock is released
  --    automatically when the transaction commits or rolls back.
  PERFORM pg_advisory_xact_lock(hashtext(NEW.room_id::text || NEW.date::text));

  -- b. No new bookings in the past (Asia/Kolkata). INSERT only, so
  --    cancelling an old booking (an UPDATE) is always allowed.
  IF TG_OP = 'INSERT' AND NEW.date < today_ist THEN
    RAISE EXCEPTION 'Cannot book a date in the past (today in Asia/Kolkata is %).', today_ist;
  END IF;

  -- Only confirmed bookings occupy a room; cancelled ones never conflict.
  IF NEW.status <> 'confirmed' THEN
    RETURN NEW;
  END IF;

  -- c. Overlap with a recurring scheduled class (same room, same weekday).
  booking_dow := extract(dow FROM NEW.date);

  SELECT EXISTS (
    SELECT 1 FROM schedules
    WHERE room_id = NEW.room_id
      AND day_of_week = booking_dow
      AND start_time < NEW.end_time
      AND end_time > NEW.start_time
  ) INTO has_schedule_overlap;

  IF has_schedule_overlap THEN
    RAISE EXCEPTION 'Booking overlaps with a recurring scheduled class.';
  END IF;

  -- d. Overlap with another confirmed booking (same room, same date).
  SELECT EXISTS (
    SELECT 1 FROM bookings
    WHERE room_id = NEW.room_id
      AND date = NEW.date
      AND status = 'confirmed'
      AND id <> NEW.id -- exclude self when updating
      AND start_time < NEW.end_time
      AND end_time > NEW.start_time
  ) INTO has_booking_overlap;

  IF has_booking_overlap THEN
    RAISE EXCEPTION 'Booking overlaps with an existing confirmed booking.';
  END IF;

  RETURN NEW;
END;
$$;

-- 3. Re-create the trigger (same name, same timing as before).
DROP TRIGGER IF EXISTS trg_check_booking_overlap ON public.bookings;
CREATE TRIGGER trg_check_booking_overlap
BEFORE INSERT OR UPDATE ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.check_booking_overlap();

COMMIT;
