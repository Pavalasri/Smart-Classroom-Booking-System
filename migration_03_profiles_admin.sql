-- =============================================================================
-- migration_03_profiles_admin.sql
-- -----------------------------------------------------------------------------
-- WHAT THIS CHANGES
--   1. New table public.profiles (id -> auth.users, email, role).
--      role is 'student' (default) or 'admin'. RLS enabled.
--      - A user can read their own profile; admins can read all profiles.
--      - NO insert/update/delete policies for API users, so nobody can
--        promote themselves. Promotion is done manually in the SQL Editor.
--   2. public.is_admin(): SECURITY DEFINER helper used by every admin policy.
--      Because it runs as the function owner it bypasses RLS on profiles,
--      so policies never recurse into profiles' own policies.
--   3. Trigger on auth.users that creates a 'student' profile for every new
--      sign-up (SECURITY DEFINER, fixed search_path), plus a one-off backfill
--      for users who signed up before this migration.
--   4. Admin policies:
--      - rooms, schedules: admins may INSERT / UPDATE / DELETE.
--      - bookings: admins may cancel ANY confirmed booking (status only;
--        the column-level GRANT from migration_02 still applies).
--   5. Trigger on rooms (BEFORE DELETE) that blocks deleting a room which
--      still has upcoming confirmed bookings. bookings.room_id is
--      ON DELETE CASCADE, so without this an admin could silently wipe
--      future reservations. Past/cancelled bookings are still cascaded.
--
-- REQUIRES: migration_01 and migration_02 to have been run first.
-- SAFE TO RE-RUN: yes (idempotent).
--
-- PROMOTE YOURSELF TO ADMIN (run manually after signing up in the app):
--   UPDATE public.profiles SET role = 'admin' WHERE email = 'your-email@example.com';
--
-- ROLLBACK:
--   DROP TRIGGER  IF EXISTS trg_block_room_delete ON public.rooms;
--   DROP FUNCTION IF EXISTS public.block_room_delete_with_upcoming();
--   DROP POLICY IF EXISTS "Admins insert rooms"      ON public.rooms;
--   DROP POLICY IF EXISTS "Admins update rooms"      ON public.rooms;
--   DROP POLICY IF EXISTS "Admins delete rooms"      ON public.rooms;
--   DROP POLICY IF EXISTS "Admins insert schedules"  ON public.schedules;
--   DROP POLICY IF EXISTS "Admins update schedules"  ON public.schedules;
--   DROP POLICY IF EXISTS "Admins delete schedules"  ON public.schedules;
--   DROP POLICY IF EXISTS "Admins cancel any booking" ON public.bookings;
--   DROP TRIGGER  IF EXISTS on_auth_user_created ON auth.users;
--   DROP FUNCTION IF EXISTS public.handle_new_user();
--   DROP FUNCTION IF EXISTS public.is_admin();   -- after the policies above
--   DROP TABLE    IF EXISTS public.profiles;
-- =============================================================================

BEGIN;

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

COMMIT;
