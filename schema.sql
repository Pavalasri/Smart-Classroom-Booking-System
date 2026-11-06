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

-- =============================================================================
-- 5. Profiles, admin role and admin policies (same as migration_03)
--    Promote yourself after signing up:
--    UPDATE public.profiles SET role = 'admin' WHERE email = 'your-email@example.com';
-- =============================================================================
-- 1. profiles table ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      TEXT,
  role       TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- API users may only read; all writes go through the trigger or SQL Editor.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.profiles FROM anon, authenticated;

-- 2. is_admin() helper -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- Profiles: read own row, admins read all. (Uses is_admin(), not a
-- sub-select on profiles, so there is no policy recursion.)
DROP POLICY IF EXISTS "Read own profile or admin reads all" ON public.profiles;
CREATE POLICY "Read own profile or admin reads all" ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.is_admin());

-- 3. Auto-create a profile for each new auth user ---------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (NEW.id, NEW.email)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- (Trigger functions cannot be called directly through the API, so no
--  extra REVOKE is needed; Supabase Auth must be able to fire it.)

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();

-- Backfill users who already exist (everyone starts as 'student').
INSERT INTO public.profiles (id, email)
SELECT id, email FROM auth.users
ON CONFLICT (id) DO NOTHING;

-- 4. Admin policies ----------------------------------------------------------
-- rooms
DROP POLICY IF EXISTS "Admins insert rooms" ON public.rooms;
CREATE POLICY "Admins insert rooms" ON public.rooms
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins update rooms" ON public.rooms;
CREATE POLICY "Admins update rooms" ON public.rooms
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins delete rooms" ON public.rooms;
CREATE POLICY "Admins delete rooms" ON public.rooms
  FOR DELETE TO authenticated USING (public.is_admin());

-- schedules
DROP POLICY IF EXISTS "Admins insert schedules" ON public.schedules;
CREATE POLICY "Admins insert schedules" ON public.schedules
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins update schedules" ON public.schedules;
CREATE POLICY "Admins update schedules" ON public.schedules
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins delete schedules" ON public.schedules;
CREATE POLICY "Admins delete schedules" ON public.schedules
  FOR DELETE TO authenticated USING (public.is_admin());

-- bookings: admins may only cancel (confirmed -> cancelled), never edit.
DROP POLICY IF EXISTS "Admins cancel any booking" ON public.bookings;
CREATE POLICY "Admins cancel any booking" ON public.bookings
  FOR UPDATE TO authenticated
  USING (public.is_admin() AND status = 'confirmed')
  WITH CHECK (public.is_admin() AND status = 'cancelled');

-- 5. Block deleting a room that still has upcoming confirmed bookings -------
CREATE OR REPLACE FUNCTION public.block_room_delete_with_upcoming()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  upcoming_count INT;
BEGIN
  SELECT count(*) INTO upcoming_count
  FROM public.bookings
  WHERE room_id = OLD.id
    AND status = 'confirmed'
    AND date >= (now() AT TIME ZONE 'Asia/Kolkata')::date;

  IF upcoming_count > 0 THEN
    RAISE EXCEPTION 'Cannot delete room "%": it has % upcoming confirmed booking(s). Cancel them first.',
      OLD.name, upcoming_count;
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_room_delete ON public.rooms;
CREATE TRIGGER trg_block_room_delete
BEFORE DELETE ON public.rooms
FOR EACH ROW
EXECUTE FUNCTION public.block_room_delete_with_upcoming();
