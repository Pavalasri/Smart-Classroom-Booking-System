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
    date DATE NOT NULL CHECK (date >= CURRENT_DATE),
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    booked_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('confirmed', 'cancelled')) DEFAULT 'confirmed',
    CONSTRAINT check_booking_times CHECK (start_time < end_time)
);

-- Enable RLS for bookings
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read bookings" ON bookings FOR SELECT USING (true);
CREATE POLICY "Allow authenticated insert bookings" ON bookings FOR INSERT 
    TO authenticated 
    WITH CHECK (auth.uid() = booked_by);
CREATE POLICY "Allow user update own bookings" ON bookings FOR UPDATE 
    TO authenticated 
    USING (auth.uid() = booked_by)
    WITH CHECK (auth.uid() = booked_by);

-- 4. Overlap Check Trigger function
CREATE OR REPLACE FUNCTION check_booking_overlap()
RETURNS TRIGGER AS $$
DECLARE
  has_schedule_overlap BOOLEAN;
  has_booking_overlap BOOLEAN;
  booking_dow INT;
BEGIN
  -- Only validate confirmed bookings
  IF NEW.status != 'confirmed' THEN
    RETURN NEW;
  END IF;

  -- 1. Check schedule overlaps (same day of week, same room, overlapping time)
  booking_dow := extract(dow from NEW.date);
  
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

  -- 2. Check bookings overlaps (same date, same room, confirmed status, overlapping time)
  SELECT EXISTS (
    SELECT 1 FROM bookings
    WHERE room_id = NEW.room_id
      AND date = NEW.date
      AND status = 'confirmed'
      AND id != NEW.id -- exclude self when updating
      AND start_time < NEW.end_time
      AND end_time > NEW.start_time
  ) INTO has_booking_overlap;

  IF has_booking_overlap THEN
    RAISE EXCEPTION 'Booking overlaps with an existing confirmed booking.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create the trigger
CREATE TRIGGER trg_check_booking_overlap
BEFORE INSERT OR UPDATE ON bookings
FOR EACH ROW
EXECUTE FUNCTION check_booking_overlap();
