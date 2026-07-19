-- Create composite indices to optimize overlap checks and queries
CREATE INDEX IF NOT EXISTS idx_bookings_overlap_check 
ON bookings (room_id, date, start_time, end_time) 
WHERE (status = 'confirmed');

CREATE INDEX IF NOT EXISTS idx_schedules_overlap_check 
ON schedules (room_id, day_of_week, start_time, end_time);
