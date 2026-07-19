-- Seed Rooms
INSERT INTO rooms (name, building, capacity) VALUES
('Room 101', 'Science Hall', 40),
('Room 102', 'Science Hall', 60),
('Room 201', 'Science Hall', 35),
('Room 202', 'Science Hall', 80),
('Room 301', 'Science Hall', 120),
('Hall A', 'Arts Building', 150),
('Room 105', 'Arts Building', 30),
('Room 106', 'Arts Building', 45),
('Room 205', 'Arts Building', 40),
('Room 206', 'Arts Building', 55)
ON CONFLICT (name) DO NOTHING;

-- Seed Schedules (Recurring classes)
-- Let's assign recurring classes to these rooms for Monday (1) through Friday (5)
-- Room 101
INSERT INTO schedules (room_id, day_of_week, start_time, end_time, course_name)
SELECT id, 1, '09:00:00', '10:30:00', 'Introduction to Physics' FROM rooms WHERE name = 'Room 101';
INSERT INTO schedules (room_id, day_of_week, start_time, end_time, course_name)
SELECT id, 1, '11:00:00', '12:30:00', 'Chemistry I' FROM rooms WHERE name = 'Room 101';
INSERT INTO schedules (room_id, day_of_week, start_time, end_time, course_name)
SELECT id, 3, '09:00:00', '10:30:00', 'Introduction to Physics' FROM rooms WHERE name = 'Room 101';

-- Room 102
INSERT INTO schedules (room_id, day_of_week, start_time, end_time, course_name)
SELECT id, 2, '10:00:00', '12:00:00', 'Calculus AB' FROM rooms WHERE name = 'Room 102';
INSERT INTO schedules (room_id, day_of_week, start_time, end_time, course_name)
SELECT id, 4, '10:00:00', '12:00:00', 'Calculus AB' FROM rooms WHERE name = 'Room 102';

-- Room 202
INSERT INTO schedules (room_id, day_of_week, start_time, end_time, course_name)
SELECT id, 1, '14:00:00', '16:00:00', 'Organic Chemistry' FROM rooms WHERE name = 'Room 202';
INSERT INTO schedules (room_id, day_of_week, start_time, end_time, course_name)
SELECT id, 3, '14:00:00', '16:00:00', 'Organic Chemistry' FROM rooms WHERE name = 'Room 202';

-- Room 301
INSERT INTO schedules (room_id, day_of_week, start_time, end_time, course_name)
SELECT id, 5, '09:00:00', '12:00:00', 'Biology Lab' FROM rooms WHERE name = 'Room 301';

-- Hall A
INSERT INTO schedules (room_id, day_of_week, start_time, end_time, course_name)
SELECT id, 1, '10:00:00', '11:30:00', 'History of Western Art' FROM rooms WHERE name = 'Hall A';
INSERT INTO schedules (room_id, day_of_week, start_time, end_time, course_name)
SELECT id, 3, '10:00:00', '11:30:00', 'History of Western Art' FROM rooms WHERE name = 'Hall A';
INSERT INTO schedules (room_id, day_of_week, start_time, end_time, course_name)
SELECT id, 2, '13:00:00', '15:00:00', 'Introduction to Sociology' FROM rooms WHERE name = 'Hall A';

-- Room 105
INSERT INTO schedules (room_id, day_of_week, start_time, end_time, course_name)
SELECT id, 4, '09:00:00', '11:00:00', 'English Literature' FROM rooms WHERE name = 'Room 105';

-- Room 205
INSERT INTO schedules (room_id, day_of_week, start_time, end_time, course_name)
SELECT id, 2, '15:30:00', '17:00:00', 'Macroeconomics' FROM rooms WHERE name = 'Room 205';
INSERT INTO schedules (room_id, day_of_week, start_time, end_time, course_name)
SELECT id, 4, '15:30:00', '17:00:00', 'Macroeconomics' FROM rooms WHERE name = 'Room 205';

-- Seed new buildings: Auditorium, Seminar Hall, Engineering Building
INSERT INTO rooms (name, building, capacity) VALUES
('Main Auditorium', 'Auditorium', 400),
('Mini Auditorium', 'Auditorium', 150),
('Seminar Hall A', 'Seminar Hall', 100),
('Seminar Hall B', 'Seminar Hall', 80),
('ECE Lab 102', 'Engineering Building', 50),
('CSE Lab 304', 'Engineering Building', 60),
('Mech Workshop', 'Engineering Building', 80)
ON CONFLICT (name) DO NOTHING;

-- Seed Schedules for new rooms
-- Main Auditorium
INSERT INTO schedules (room_id, day_of_week, start_time, end_time, course_name)
SELECT id, 1, '10:00:00', '12:00:00', 'University Guest Lecture' FROM rooms WHERE name = 'Main Auditorium';
INSERT INTO schedules (room_id, day_of_week, start_time, end_time, course_name)
SELECT id, 3, '14:00:00', '16:00:00', 'Drama and Arts Seminar' FROM rooms WHERE name = 'Main Auditorium';

-- Seminar Hall A
INSERT INTO schedules (room_id, day_of_week, start_time, end_time, course_name)
SELECT id, 2, '09:00:00', '11:00:00', 'Research Presentation' FROM rooms WHERE name = 'Seminar Hall A';
INSERT INTO schedules (room_id, day_of_week, start_time, end_time, course_name)
SELECT id, 4, '11:30:00', '13:00:00', 'Entrepreneurship Panel' FROM rooms WHERE name = 'Seminar Hall A';

-- CSE Lab 304
INSERT INTO schedules (room_id, day_of_week, start_time, end_time, course_name)
SELECT id, 1, '08:30:00', '11:30:00', 'Data Structures Lab' FROM rooms WHERE name = 'CSE Lab 304';
INSERT INTO schedules (room_id, day_of_week, start_time, end_time, course_name)
SELECT id, 3, '08:30:00', '11:30:00', 'Object Oriented Programming' FROM rooms WHERE name = 'CSE Lab 304';
INSERT INTO schedules (room_id, day_of_week, start_time, end_time, course_name)
SELECT id, 5, '13:00:00', '15:30:00', 'AI & Machine Learning Lab' FROM rooms WHERE name = 'CSE Lab 304';

-- ECE Lab 102
INSERT INTO schedules (room_id, day_of_week, start_time, end_time, course_name)
SELECT id, 2, '14:00:00', '17:00:00', 'Digital Electronics Lab' FROM rooms WHERE name = 'ECE Lab 102';
INSERT INTO schedules (room_id, day_of_week, start_time, end_time, course_name)
SELECT id, 4, '14:00:00', '17:00:00', 'Microprocessors Lab' FROM rooms WHERE name = 'ECE Lab 102';

