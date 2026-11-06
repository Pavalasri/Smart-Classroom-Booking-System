# CampusFlow | University Classroom Booking Dashboard

**Live demo:** https://smart-classroom-booking-system.vercel.app

CampusFlow is a full-stack, real-time university classroom booking dashboard designed for students and faculty. It calculates classroom occupancy live (Green = vacant, Red = occupied by scheduled class, Yellow = booked ad-hoc) based on recurring weekly timetables and active reservations.

## Tech Stack
*   **Frontend**: React (Vite) + Tailwind CSS v4
*   **Backend/DB**: Supabase (PostgreSQL + Auth + Real-time subscriptions)
*   **Libraries**: `@supabase/supabase-js`, `lucide-react` (icons), `canvas-confetti`

---

## Project Workflow, Problem Statement & Solution

### Problem Statement
In traditional university systems, checking classroom availability and booking rooms for ad-hoc study sessions or meetings suffers from several issues:
1. **Double Bookings**: Multiple users booking the same room for overlapping times.
2. **Race Conditions**: Two users submitting a request for the same slot at the exact same moment.
3. **Stale Views**: Dashboards showing static lists of occupied rooms, forcing page refreshes to see actual status.
4. **Integration of Timetables & Bookings**: Difficulty in merging read-only recurring weekly classes (schedules) with user-made ad-hoc reservations (bookings).

### Solution
CampusFlow addresses these issues with:
1. **Dynamic Occupancy Calculations**: Classroom availability is calculated on-read for any target day/time by analyzing schedules and bookings together, ensuring data is never stale.
2. **PostgreSQL Database-Level Transaction Triggers**: A custom database validation trigger runs on every insert or update transaction, guaranteeing transaction safety and completely eliminating double bookings due to race conditions.
3. **Real-time Synchronization**: The client subscribes to changes in the database using Supabase Realtime, immediately updating the UI for all connected users as soon as a booking is created or cancelled.
4. **Sleek Time Travel scrubbers**: An interactive range selector allows users to browse occupancy at any hour of the day in real-time.

### Project Workflow
1. **Explore Availability**: A user visits the dashboard, filters by building, and sees classroom cards colored dynamically:
   - **Green (Vacant)**: No recurring class or active ad-hoc booking at the selected time.
   - **Red (Occupied)**: A recurring weekly class is active.
   - **Yellow (Booked)**: An ad-hoc user booking is active.
2. **Time Travel**: The user scrubs the timeline slider to view how room availability changes throughout the day.
3. **Authentication Prompt**: To secure reservations, users click **Book Room** (or *Sign In*) to open a glassmorphic login/registration sheet.
4. **Time Selection**: Once logged in, the user opens the booking modal, selects a date, and sets a start and end time (restricted to 30-minute intervals).
5. **Conflict Checks**:
   - The application checks the local cache of schedules and bookings and gives instant feedback if there's a conflict.
   - If the precheck passes, a DB write is made. The PostgreSQL trigger runs to guarantee no overlap exists, returning an error to the UI if a conflict occurred.
6. **Confetti & Realtime Broadcast**: On a successful booking, confetti animations play. The database insert fires a Realtime broadcast to all other open tabs, which automatically recalculate statuses and update room cards instantly.
7. **Reservation Management**: Users can cancel their own confirmed bookings from the timeline or the My Bookings page. Cancelling is a *soft cancel*: the row is kept with `status = 'cancelled'` (nothing is deleted), so history is preserved. Cancelled bookings are ignored by the overlap trigger and by the occupancy calculation, so the slot becomes free immediately.

---

## Overlap-Check Logic (How We Prevent Double Booking)

To ensure that room bookings never conflict, CampusFlow uses a **dual-layer overlap validation system**:

### 1. Database-Level Transaction Safety (PostgreSQL Trigger)
To prevent race conditions (e.g., two users booking the exact same slot at the exact same millisecond), the booking validation is enforced at the database level.
*   We use a `BEFORE INSERT OR UPDATE` trigger named `trg_check_booking_overlap` on the `bookings` table.
*   When an insert or update is attempted, the trigger function `check_booking_overlap()` does two checks:
    1.  **Schedules Overlap Check**: It extracts the day of the week (`0-6`) for the booking date and checks the `schedules` table for any overlapping recurring class (`start_time < NEW.end_time AND end_time > NEW.start_time`) in the same room.
    2.  **Bookings Overlap Check**: It checks the `bookings` table for other confirmed bookings on the same date (`date = NEW.date`) that overlap with the requested time.
*   If either check fails, the transaction is aborted with `RAISE EXCEPTION`, returning a clear error message to the client.

### 2. Client-Side Instant Validation
To provide immediate visual feedback without requiring a server roundtrip, the frontend checks the proposed slot against local states of `schedules` and `bookings` (which are loaded and kept in sync in real-time) before dispatching the database request. If a conflict is found, the modal alerts the user immediately.

---

## Database Schema

Run the following tables, constraints, policies, and triggers in your Supabase SQL Editor. The code is available in [schema.sql](schema.sql).

### Rooms Table
```sql
CREATE TABLE rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    building TEXT NOT NULL,
    capacity INT NOT NULL CHECK (capacity > 0)
);
```

### Schedules Table (Read-only Timetable)
```sql
CREATE TABLE schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    day_of_week INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0 = Sunday, 6 = Saturday
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    course_name TEXT NOT NULL,
    CONSTRAINT check_schedule_times CHECK (start_time < end_time)
);
```

### Bookings Table (Ad-hoc Bookings)
```sql
CREATE TABLE bookings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    date DATE NOT NULL CHECK (date >= CURRENT_DATE),
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    booked_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('confirmed', 'cancelled')) DEFAULT 'confirmed',
    CONSTRAINT check_booking_times CHECK (start_time < end_time)
);
```

---

## Setup & Local Installation

### 1. Database Setup in Supabase
1.  Go to [Supabase Console](https://supabase.com/) and create a new project.
2.  Open the **SQL Editor** in your project dashboard.
3.  Copy and run the contents of [schema.sql](schema.sql) to create the schema, enable RLS, set up policies, and create the validation trigger.
4.  Copy and run the contents of [seed.sql](seed.sql) to populate 10 classrooms across 2 buildings along with recurring schedules.
5.  Go to **Database** -> **Replication** -> **Source tables** and toggle **bookings** to active. This enables Supabase Realtime subscriptions on the `bookings` table.

### 2. Local App Setup
1.  Clone this repository and enter the project folder:
    ```bash
    git clone <repo-url>
    cd Smart-Classroom-Booking-System
    ```
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Create a `.env` file in the root directory (you can copy `.env.example` as a starting point):
    ```bash
    cp .env.example .env
    ```
4.  Fill in your Supabase credentials in `.env`:
    ```env
    VITE_SUPABASE_URL=your_supabase_project_url
    VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
    ```
5.  Start the local development server:
    ```bash
    npm run dev
    ```
6.  Open `http://localhost:5173` in your browser.

---


