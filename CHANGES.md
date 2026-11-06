# CHANGES

All changes made on the `improvements` branch, relative to commit `db00ad1`.
Database changes are **not applied automatically**: run the migration files
manually in the Supabase SQL Editor (see README → *Setup*).

## Added

| File | Why |
|---|---|
| `LICENSE` | MIT license, © 2026 Pavalasri K. |
| `CHANGES.md` | This file. |
| `migration_01_date_check_timezone.sql` | Drops `CHECK (date >= CURRENT_DATE)` (it was re-evaluated on every UPDATE, so cancelling a past booking failed). Rewrites `check_booking_overlap()` with an advisory lock per room+date (fixes the race condition), a past-date check on INSERT only using Asia/Kolkata, and `SECURITY DEFINER` + `search_path = public`. Re-creates `trg_check_booking_overlap`. |
| `migration_02_rls_hardening.sql` | Users may insert only their own `confirmed` bookings and may only change their own confirmed booking to `cancelled`. Column-level `GRANT UPDATE (status)` so room/date/time/owner cannot be edited. Revokes DELETE/TRUNCATE on bookings and TRUNCATE on reference tables. |
| `migration_03_profiles_admin.sql` | `profiles` table (`student` / `admin`), `SECURITY DEFINER` `is_admin()`, sign-up trigger on `auth.users` + backfill, admin RLS policies for rooms/schedules, admin may cancel any booking, trigger blocking deletion of rooms with upcoming bookings. |
| `src/lib/time.js` | Asia/Kolkata helpers: `getTodayStr`, `getCurrentTimeStr`, `getCurrentMinutes`, timezone-safe `getDayOfWeek`, `addDays`. |
| `src/lib/bookings.js` | Shared `cancelBooking()` (soft cancel that detects RLS-blocked 0-row updates) and `isUpcoming()`. |
| `src/components/MyBookings.jsx` | My Bookings page: upcoming and past bookings with room, date, time and status; cancel upcoming ones; per-user Realtime channel. |
| `src/components/AdminPanel.jsx` | Admin page: add/edit/delete rooms (with upcoming-booking check and cascade warning), list all bookings and cancel any upcoming one. |
| `src/components/AdminAnalytics.jsx` | Admin charts (plain SVG): bookings per room and peak booking hours for the last 30 days, computed client-side; hover tooltips and a table view. |
| `tests/api-tests.mjs` | Automated API test suite (`npm run test:api`). Uses only the anon key from `.env.test` (refuses secret/service-role keys, never reads `.env`), signs up throw-away users and checks the sign-up trigger, 10 concurrent inserts (exactly 1 wins), schedule and past-date rejection, cancel rules, column-level edit protection, student/anonymous/admin RLS and the room-delete guard. Each test cleans up after itself. |
| `tests/TEST_RESULTS.md` | Results of the last run against the separate test project (14/14 passed). The script redacts the project ref and test emails (`<test-project>`, `<test-user:…>`) so the file is safe to commit. |

## Modified

| File | Why |
|---|---|
| `README.md` | Live URL at the top; fixed broken `file:///` links and clone instructions; documented soft cancel; full rewrite with features, Mermaid architecture diagram, security model, Supabase/Vercel setup, migration order, admin promotion SQL, 13 manual test cases and future scope. Later: "Testing" section explaining how to run `npm run test:api` against a separate test project, and "Security notes" (only a publishable/anon key was ever committed, in `c4de112`, removed the same day in `694b536`; access is enforced by RLS; service-role keys must never be committed or used in the frontend). |
| `.env.example` | Restored (it had been deleted in the working tree) with placeholder values only: `https://your-project-ref.supabase.co` / `your-anon-key`. |
| `.gitignore` | Ignores `.env.test` (in addition to `.env`, `.env.local` and the other `.env.*.local` files) so test-project credentials are never committed. |
| `schema.sql` | Kept in sync with migrations 01–03 so a fresh project still works from one file: no date CHECK, new trigger function, tightened booking policies and grants, profiles/admin section. |
| `package.json`, `package-lock.json` | Package name `smart-classroom` → `campusflow`. `package.json` also gets the `test:api` script (`node tests/api-tests.mjs`). |
| `src/App.jsx` | Uses `lib/time.js` (IST "today", now-line, weekday); uses shared `cancelBooking()`; inline "My Reservations" table replaced by a Dashboard / My Bookings / Admin tab bar; loads the user's role from `profiles`; removed unused imports. *(The large diff is mostly re-indentation of the dashboard JSX inside the new `view === 'dashboard'` block.)* |
| `src/components/BookingModal.jsx` | IST "today" for the date picker, timezone-safe weekday, client-side past-date check; removed unused variable. |
| `src/components/RoomCard.jsx` | Timezone-safe weekday (`new Date('YYYY-MM-DD').getDay()` could return the previous day). |
| `src/components/Navbar.jsx` | Tagline "Smart Classroom Hub" → "Classroom Booking Hub"; Admin badge for admins. |
| `src/components/Auth.jsx` | "Join the Smart Classroom network" → "Join CampusFlow"; removed unused variable. |

## Unchanged on purpose

- `trg_check_booking_overlap` keeps its name, timing and overlap rules (only strengthened).
- Public `SELECT` on `bookings` is kept so guests see live occupancy (trade-off documented in README → *Future scope*).
- `bookings.room_id ... ON DELETE CASCADE` is not altered; deletion of rooms with upcoming bookings is blocked by a trigger instead.
- `seed.sql`, `indexes.sql`, `index.html` (title already said CampusFlow), `vite.config.js`.
- Git history was not rewritten and the committed publishable key was not rotated (by decision; see README → *Security notes*).
- Task 9 (recurring bookings) was skipped as requested.
