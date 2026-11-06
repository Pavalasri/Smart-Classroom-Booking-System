-- 1. Create rooms table
CREATE TABLE IF NOT EXISTS rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    building TEXT NOT NULL,
    capacity INT NOT NULL CHECK (capacity > 0)
);

-- Enable RLS for rooms
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read rooms" ON rooms FOR SELECT USING (true);

-- 2. Create schedules table (Recurring classes)
CREATE TABLE IF NOT EXISTS schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    day_of_week INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0 = Sunday, 6 = Saturday
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    course_name TEXT NOT NULL,
    CONSTRAINT check_schedule_times CHECK (start_time < end_time)
);

-- Enable RLS for schedules
ALTER TABLE schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read schedules" ON schedules FOR SELECT USING (true);

-- 3. Create bookings table (Ad-hoc bookings)
CREATE TABLE IF NOT EXISTS bookings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    -- No CHECK on date: a CHECK is re-evaluated on every UPDATE and would block
    -- cancelling past bookings. "No past bookings" is enforced on INSERT by the
    -- trigger below (see migration_01).
    date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    booked_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('confirmed', 'cancelled')) DEFAULT 'confirmed',
    CONSTRAINT check_booking_times CHECK (start_time < end_time)
);

-- Enable RLS for bookings
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
-- Public read keeps the live occupancy grid + Realtime working for guests.
-- Trade-off: booked_by UUIDs are visible (see README "Future scope").
CREATE POLICY "Allow public read bookings" ON bookings FOR SELECT USING (true);
-- Users may only create confirmed bookings for themselves.
CREATE POLICY "Allow authenticated insert bookings" ON bookings FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = booked_by AND status = 'confirmed');
-- Users may only cancel their own confirmed bookings (see migration_02).
CREATE POLICY "Allow user update own bookings" ON bookings FOR UPDATE
    TO authenticated
    USING (auth.uid() = booked_by AND status = 'confirmed')
    WITH CHECK (auth.uid() = booked_by AND status = 'cancelled');

-- Only the "status" column is updatable from the API; no hard deletes.
REVOKE UPDATE ON bookings FROM anon, authenticated;
GRANT  UPDATE (status) ON bookings TO authenticated;
REVOKE DELETE, TRUNCATE ON bookings FROM anon, authenticated;
REVOKE DELETE, TRUNCATE ON rooms, schedules FROM anon;
REVOKE TRUNCATE ON rooms, schedules FROM authenticated;

-- 4. Overlap Check Trigger function
--    - advisory lock per (room, date) prevents the two-tab race condition
--    - rejects past dates on INSERT only, using Asia/Kolkata "today"
--    - SECURITY DEFINER so it sees all bookings regardless of RLS
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

-- Create the trigger
DROP TRIGGER IF EXISTS trg_check_booking_overlap ON public.bookings;
CREATE TRIGGER trg_check_booking_overlap
BEFORE INSERT OR UPDATE ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.check_booking_overlap();
