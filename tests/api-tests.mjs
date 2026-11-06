// =============================================================================
// CampusFlow API test suite (run with: npm run test:api)
// -----------------------------------------------------------------------------
// - Talks to the TEST Supabase project configured in .env.test ONLY.
//   It never reads .env (production) and refuses to run with a secret /
//   service-role key: everything goes through the public anon key + user JWTs,
//   exactly like the real app, so RLS, grants and triggers are what is tested.
// - Signs up three throw-away users (studentA, studentB, adminuser).
//   Email confirmation must be disabled on the test project.
// - Runs student + anonymous tests, then prints the SQL to promote the admin
//   and waits (press Enter in a terminal, or it polls profiles.role for up to
//   20 minutes when not run interactively), then runs the admin tests.
// - Each test cleans up after itself (bookings are soft-cancelled, test rooms
//   are deleted by the admin). The test auth users remain in auth.users; delete
//   them from the dashboard (Authentication -> Users) if you want.
// - Writes the results table to tests/TEST_RESULTS.md.
// =============================================================================

import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

// ---------------------------------------------------------------------------
// Config: .env.test only
// ---------------------------------------------------------------------------
process.loadEnvFile(join(ROOT, '.env.test'))
const URL_ = process.env.VITE_SUPABASE_URL
const KEY = process.env.VITE_SUPABASE_ANON_KEY
if (!URL_ || !KEY) throw new Error('.env.test must define VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY')

const keyRole = (() => {
  if (KEY.startsWith('sb_publishable_')) return 'anon'
  if (KEY.startsWith('sb_secret_')) return 'service_role'
  try { return JSON.parse(Buffer.from(KEY.split('.')[1], 'base64url')).role } catch { return 'unknown' }
})()
if (keyRole !== 'anon') {
  throw new Error(`Refusing to run: the key in .env.test is "${keyRole}", expected the anon/publishable key.`)
}

const newClient = () =>
  createClient(URL_, KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
const TS = Date.now()
const strongPassword = () => `${randomBytes(12).toString('base64url')}Aa1!`

// Campus timezone date helpers (same rules as the app / trigger).
const todayIST = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const addDays = (dateStr, n) => {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}
const dow = (dateStr) => {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

// A random far-future base date so repeated runs never collide.
const BASE_DATE = addDays(todayIST(), 400 + Math.floor(Math.random() * 1500))
let dateCounter = 0
const nextTestDate = () => addDays(BASE_DATE, dateCounter++)

class AssertionError extends Error {}
const assert = (cond, msg) => { if (!cond) throw new AssertionError(msg) }

// Runs a write that SHOULD be blocked. Blocked = an error, or 0 rows affected.
// Returns a description; throws if the write actually succeeded.
async function expectBlocked(label, query) {
  const { data, error } = await query
  if (error) return `${label}: blocked (${error.code ?? ''} ${error.message})`.replace('( ', '(')
  if (!data || data.length === 0) return `${label}: blocked (0 rows affected)`
  throw new AssertionError(`${label}: NOT blocked - ${data.length} row(s) changed`)
}

const results = []
async function runTest(id, name, fn) {
  process.stdout.write(`\n[${id}] ${name}\n`)
  try {
    const detail = await fn()
    results.push({ id, name, status: 'PASS', detail })
    console.log(`  PASS - ${detail}`)
  } catch (err) {
    const detail = err?.message || String(err)
    results.push({ id, name, status: 'FAIL', detail })
    console.log(`  FAIL - ${detail}`)
  }
}
const skip = (id, name, why) => {
  results.push({ id, name, status: 'SKIP', detail: why })
  console.log(`\n[${id}] ${name}\n  SKIP - ${why}`)
}

// Booking helpers ------------------------------------------------------------
const insertBooking = (user, { room_id, date, start, end }) =>
  user.client
    .from('bookings')
    .insert([{ room_id, date, start_time: start, end_time: end, booked_by: user.id, status: 'confirmed' }])
    .select('id')

async function mustInsertBooking(user, slot) {
  const { data, error } = await insertBooking(user, slot)
  if (error) throw new Error(`setup insert failed: ${error.message}`)
  return data[0].id
}

// Best-effort cleanup: soft-cancel a booking (ignores "already cancelled").
async function cancelQuietly(client, id) {
  if (!id) return
  await client.from('bookings').update({ status: 'cancelled' }).eq('id', id).eq('status', 'confirmed')
}

const readBooking = async (id) => {
  const { data, error } = await anon.from('bookings').select('*').eq('id', id).single()
  if (error) throw new Error(`could not read booking ${id}: ${error.message}`)
  return data
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
const anon = newClient()

async function signUp(label) {
  const email = `${label.toLowerCase()}+${TS}@example.com`
  const password = strongPassword()
  const client = newClient()
  const { data, error } = await client.auth.signUp({ email, password })
  if (error) throw new Error(`sign-up of ${email} failed: ${error.message}`)
  if (!data.session) {
    throw new Error(`sign-up of ${email} returned no session - is email confirmation disabled on the test project?`)
  }
  return { label, email, id: data.user.id, client }
}

async function main() {
  console.log('CampusFlow API tests')
  console.log(`Project: ${new globalThis.URL(URL_).host} (from .env.test, key type: ${keyRole})`)
  console.log(`Run id: ${TS}, test dates start at ${BASE_DATE}`)

  // Reference data (public read).
  const { data: rooms, error: roomsErr } = await anon.from('rooms').select('*').order('name')
  if (roomsErr) throw new Error(`cannot read rooms: ${roomsErr.message}`)
  const { data: schedules, error: schedErr } = await anon.from('schedules').select('*')
  if (schedErr) throw new Error(`cannot read schedules: ${schedErr.message}`)
  if (rooms.length < 2) throw new Error('need at least 2 rooms in the test project (run seed.sql)')

  // Prefer rooms without any timetable so evening slots are always free.
  const scheduledRoomIds = new Set(schedules.map((s) => s.room_id))
  const freeRooms = [...rooms.filter((r) => !scheduledRoomIds.has(r.id)), ...rooms.filter((r) => scheduledRoomIds.has(r.id))]
  const ROOM = freeRooms[0]
  const OTHER_ROOM = freeRooms[1]
  const slot = (start, end, room = ROOM) => ({ room_id: room.id, date: nextTestDate(), start, end })
  // Evening slots: seed.sql has no classes after 17:00.
  const EVENING = ['20:00:00', '21:00:00']

  console.log(`Using room "${ROOM.name}" (and "${OTHER_ROOM.name}")`)

  // ---- Users ---------------------------------------------------------------
  let A, B, ADMIN
  await runTest('setup', 'Sign up studentA, studentB, adminuser (anon key)', async () => {
    A = await signUp('studentA')
    B = await signUp('studentB')
    ADMIN = await signUp('adminuser')
    return `created ${A.email}, ${B.email}, ${ADMIN.email}`
  })
  if (!A || !B || !ADMIN) {
    console.log('\nCannot continue without the test users.')
    return
  }

  await runTest('trigger', 'Sign-up trigger: each user reads own profile with role "student"', async () => {
    const out = []
    for (const u of [A, B, ADMIN]) {
      const { data, error } = await u.client.from('profiles').select('id, email, role').eq('id', u.id).maybeSingle()
      assert(!error, `${u.label}: ${error?.message}`)
      assert(data, `${u.label}: no profile row visible (trigger missing or RLS blocks own row)`)
      assert(data.role === 'student', `${u.label}: role is "${data.role}", expected "student"`)
      out.push(`${u.label}=student`)
    }
    // A must NOT see B's profile.
    const { data: other } = await A.client.from('profiles').select('id').eq('id', B.id)
    assert((other || []).length === 0, 'studentA can read studentB\'s profile')
    return `${out.join(', ')}; studentA cannot read studentB's profile`
  })

  // ---- Student + anonymous tests -------------------------------------------
  await runTest('a', '10 simultaneous inserts for the same room/date/slot -> exactly 1 succeeds', async () => {
    const s = slot(...EVENING)
    const users = Array.from({ length: 10 }, (_, i) => (i % 2 === 0 ? A : B))
    const responses = await Promise.all(users.map((u) => insertBooking(u, s)))
    const wins = responses.map((r, i) => ({ r, u: users[i] })).filter((x) => !x.r.error)
    try {
      const errors = responses.filter((r) => r.error).map((r) => r.error.message)
      const nonOverlap = errors.filter((m) => !/overlap/i.test(m))
      assert(wins.length === 1, `${wins.length} inserts succeeded (expected 1). Errors: ${[...new Set(errors)].join(' | ')}`)
      assert(nonOverlap.length === 0, `unexpected error(s): ${[...new Set(nonOverlap)].join(' | ')}`)
      return `1 succeeded, 9 rejected: "${errors[0]}"`
    } finally {
      for (const w of wins) await cancelQuietly(w.u.client, w.r.data[0].id)
    }
  })

  await runTest('b', 'Insert overlapping a recurring scheduled class is rejected', async () => {
    const s = schedules[0]
    assert(s, 'no schedules in the test project (run seed.sql)')
    let date = nextTestDate()
    while (dow(date) !== Number(s.day_of_week)) date = nextTestDate()
    const room = rooms.find((r) => r.id === s.room_id)
    const { data, error } = await insertBooking(A, { room_id: s.room_id, date, start: s.start_time, end: s.end_time })
    if (!error) {
      await cancelQuietly(A.client, data[0].id)
      throw new AssertionError(`insert over "${s.course_name}" in ${room?.name} on ${date} was ACCEPTED`)
    }
    assert(/recurring|schedule/i.test(error.message), `rejected, but with an unexpected error: ${error.message}`)
    return `"${s.course_name}" (${room?.name}, ${date}): ${error.message}`
  })

  await runTest('c', 'Booking a past date is rejected', async () => {
    const yesterday = addDays(todayIST(), -1)
    const { data, error } = await insertBooking(A, { room_id: ROOM.id, date: yesterday, start: EVENING[0], end: EVENING[1] })
    if (!error) {
      await cancelQuietly(A.client, data[0].id)
      throw new AssertionError(`booking on ${yesterday} was ACCEPTED`)
    }
    assert(/past/i.test(error.message), `rejected, but with an unexpected error: ${error.message}`)
    return `${yesterday}: ${error.message}`
  })

  await runTest('d', 'Student A cancels own booking -> succeeds', async () => {
    const id = await mustInsertBooking(A, slot(...EVENING))
    try {
      const { data, error } = await A.client.from('bookings').update({ status: 'cancelled' }).eq('id', id).select('id, status')
      assert(!error, error?.message)
      assert(data.length === 1 && data[0].status === 'cancelled', `expected 1 cancelled row, got ${JSON.stringify(data)}`)
      const row = await readBooking(id)
      assert(row.status === 'cancelled', `row status is ${row.status}`)
      return '1 row updated, status = cancelled (row kept, soft cancel)'
    } finally {
      await cancelQuietly(A.client, id)
    }
  })

  await runTest('e', "Student A cannot cancel B's booking (0 rows affected)", async () => {
    const id = await mustInsertBooking(B, slot(...EVENING))
    try {
      const msg = await expectBlocked('A cancels B', A.client.from('bookings').update({ status: 'cancelled' }).eq('id', id).select('id'))
      const row = await readBooking(id)
      assert(row.status === 'confirmed', `B's booking is now ${row.status}`)
      return `${msg}; B's booking still confirmed`
    } finally {
      await cancelQuietly(B.client, id)
    }
  })

  await runTest('f', 'User cannot change room/date/time/booked_by of own booking', async () => {
    const s = slot(...EVENING)
    const id = await mustInsertBooking(A, s)
    try {
      const upd = (values) => A.client.from('bookings').update(values).eq('id', id).select('id')
      const msgs = [
        await expectBlocked('room_id', upd({ room_id: OTHER_ROOM.id })),
        await expectBlocked('date', upd({ date: addDays(s.date, 1) })),
        await expectBlocked('time', upd({ start_time: '19:00:00', end_time: '20:00:00' })),
        await expectBlocked('booked_by', upd({ booked_by: B.id })),
      ]
      const row = await readBooking(id)
      assert(
        row.room_id === s.room_id && row.date === s.date && row.start_time === s.start && row.end_time === s.end && row.booked_by === A.id,
        `row changed: ${JSON.stringify(row)}`
      )
      return `${msgs.join('; ')}; row unchanged`
    } finally {
      await cancelQuietly(A.client, id)
    }
  })

  await runTest('g', 'A cancelled booking cannot be re-confirmed', async () => {
    const id = await mustInsertBooking(A, slot(...EVENING))
    await A.client.from('bookings').update({ status: 'cancelled' }).eq('id', id)
    const msg = await expectBlocked('re-confirm', A.client.from('bookings').update({ status: 'confirmed' }).eq('id', id).select('id'))
    const row = await readBooking(id)
    assert(row.status === 'cancelled', `status is now ${row.status}`)
    return `${msg}; still cancelled`
  })

  await runTest('h', 'Student cannot update profiles.role or insert/update/delete rooms or schedules', async () => {
    const msgs = []
    msgs.push(await expectBlocked('profiles.role', A.client.from('profiles').update({ role: 'admin' }).eq('id', A.id).select('id')))
    const { data: me } = await A.client.from('profiles').select('role').eq('id', A.id).single()
    assert(me?.role === 'student', `studentA role is now ${me?.role}`)

    msgs.push(await expectBlocked('rooms insert', A.client.from('rooms').insert([{ name: `HACK ${TS}`, building: 'X', capacity: 1 }]).select('id')))
    msgs.push(await expectBlocked('rooms update', A.client.from('rooms').update({ capacity: 9999 }).eq('id', ROOM.id).select('id')))
    msgs.push(await expectBlocked('rooms delete', A.client.from('rooms').delete().eq('id', ROOM.id).select('id')))
    const { data: roomNow } = await anon.from('rooms').select('capacity').eq('id', ROOM.id).single()
    assert(roomNow && roomNow.capacity === ROOM.capacity, 'room was changed or deleted')

    const sched = schedules[0]
    msgs.push(await expectBlocked('schedules insert', A.client.from('schedules')
      .insert([{ room_id: ROOM.id, day_of_week: 0, start_time: '06:00:00', end_time: '07:00:00', course_name: `HACK ${TS}` }]).select('id')))
    msgs.push(await expectBlocked('schedules update', A.client.from('schedules').update({ course_name: 'HACKED' }).eq('id', sched.id).select('id')))
    msgs.push(await expectBlocked('schedules delete', A.client.from('schedules').delete().eq('id', sched.id).select('id')))
    const { data: schedNow } = await anon.from('schedules').select('course_name').eq('id', sched.id).single()
    assert(schedNow && schedNow.course_name === sched.course_name, 'schedule was changed or deleted')
    return msgs.join('; ')
  })

  await runTest('i', 'Anonymous users can read bookings but cannot insert or update', async () => {
    const id = await mustInsertBooking(A, slot(...EVENING))
    try {
      const { data: read, error: readErr } = await anon.from('bookings').select('id, status').eq('id', id)
      assert(!readErr, `anon read failed: ${readErr?.message}`)
      assert(read.length === 1, 'anon cannot see the booking')
      const s = slot(...EVENING)
      const ins = await expectBlocked('anon insert', anon.from('bookings')
        .insert([{ room_id: s.room_id, date: s.date, start_time: s.start, end_time: s.end, booked_by: A.id, status: 'confirmed' }]).select('id'))
      const upd = await expectBlocked('anon update', anon.from('bookings').update({ status: 'cancelled' }).eq('id', id).select('id'))
      const row = await readBooking(id)
      assert(row.status === 'confirmed', `booking is now ${row.status}`)
      return `anon read OK; ${ins}; ${upd}`
    } finally {
      await cancelQuietly(A.client, id)
    }
  })

  // ---- Admin promotion ------------------------------------------------------
  const promoteSql = `UPDATE public.profiles SET role='admin' WHERE email='${ADMIN.email}';`
  console.log('\n' + '='.repeat(78))
  console.log('ACTION NEEDED - run this in the Supabase SQL Editor of the TEST project:\n')
  console.log(`  ${promoteSql}\n`)
  console.log('='.repeat(78))

  const isAdmin = async () => {
    const { data } = await ADMIN.client.from('profiles').select('role').eq('id', ADMIN.id).maybeSingle()
    return data?.role === 'admin'
  }

  let promoted = false
  if (process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    await rl.question('Press Enter after you have run the SQL above (Ctrl+C to stop)... ')
    rl.close()
    promoted = await isAdmin()
  } else {
    console.log('Not an interactive terminal: polling profiles.role every 5 s (max 20 min)...')
    const deadline = Date.now() + 20 * 60 * 1000
    while (!promoted && Date.now() < deadline) {
      promoted = await isAdmin()
      if (!promoted) await new Promise((r) => setTimeout(r, 5000))
    }
  }

  const adminTests = [
    ['j', 'Admin can insert/update rooms and cancel any booking'],
    ['k', 'Deleting a room that has an upcoming confirmed booking is blocked'],
    ['l', "Admin cannot edit a booking's time or room"],
  ]
  if (!promoted) {
    console.log(`\n${ADMIN.email} is not an admin - skipping admin tests.`)
    for (const [id, name] of adminTests) skip(id, name, 'admin account was not promoted')
    return
  }
  console.log(`\n${ADMIN.email} is now admin - running admin tests.`)

  await runTest('j', adminTests[0][1], async () => {
    let roomId, bookingId
    try {
      const { data: ins, error: insErr } = await ADMIN.client.from('rooms')
        .insert([{ name: `TEST Room J ${TS}`, building: 'TEST', capacity: 10 }]).select('id')
      assert(!insErr, `room insert failed: ${insErr?.message}`)
      roomId = ins[0].id
      const { data: upd, error: updErr } = await ADMIN.client.from('rooms').update({ capacity: 20 }).eq('id', roomId).select('capacity')
      assert(!updErr, `room update failed: ${updErr?.message}`)
      assert(upd.length === 1 && upd[0].capacity === 20, `room update affected ${upd.length} rows`)

      bookingId = await mustInsertBooking(A, slot(...EVENING))
      const { data: c, error: cErr } = await ADMIN.client.from('bookings').update({ status: 'cancelled' }).eq('id', bookingId).select('id')
      assert(!cErr, `admin cancel failed: ${cErr?.message}`)
      assert(c.length === 1, 'admin cancel affected 0 rows')
      return 'room inserted, capacity updated 10 -> 20, studentA\'s booking cancelled by admin'
    } finally {
      await cancelQuietly(A.client, bookingId)
      if (roomId) await ADMIN.client.from('rooms').delete().eq('id', roomId)
    }
  })

  await runTest('k', adminTests[1][1], async () => {
    let roomId, bookingId
    try {
      const { data: ins, error: insErr } = await ADMIN.client.from('rooms')
        .insert([{ name: `TEST Room K ${TS}`, building: 'TEST', capacity: 10 }]).select('id')
      assert(!insErr, `room insert failed: ${insErr?.message}`)
      roomId = ins[0].id
      bookingId = await mustInsertBooking(A, { room_id: roomId, date: nextTestDate(), start: EVENING[0], end: EVENING[1] })

      const { data, error } = await ADMIN.client.from('rooms').delete().eq('id', roomId).select('id')
      if (!error && data.length > 0) {
        roomId = null // already gone
        throw new AssertionError('room with an upcoming confirmed booking was DELETED (booking cascaded)')
      }
      assert(error, 'delete affected 0 rows without an error (admin delete policy missing?)')
      assert(/upcoming/i.test(error.message), `blocked, but with an unexpected error: ${error.message}`)
      const { data: still } = await anon.from('rooms').select('id').eq('id', roomId)
      assert(still.length === 1, 'room no longer exists')
      return error.message
    } finally {
      // Cleanup: cancel the booking, then the room can be deleted (cascade
      // removes the cancelled booking row).
      await cancelQuietly(ADMIN.client, bookingId)
      if (roomId) {
        const { error } = await ADMIN.client.from('rooms').delete().eq('id', roomId)
        if (error) console.log(`  (cleanup) could not delete test room: ${error.message}`)
      }
    }
  })

  await runTest('l', adminTests[2][1], async () => {
    const s = slot(...EVENING)
    const id = await mustInsertBooking(A, s)
    try {
      const upd = (values) => ADMIN.client.from('bookings').update(values).eq('id', id).select('id')
      const m1 = await expectBlocked('admin time', upd({ start_time: '19:00:00', end_time: '20:00:00' }))
      const m2 = await expectBlocked('admin room', upd({ room_id: OTHER_ROOM.id }))
      const row = await readBooking(id)
      assert(row.room_id === s.room_id && row.start_time === s.start && row.end_time === s.end, `row changed: ${JSON.stringify(row)}`)
      return `${m1}; ${m2}; row unchanged`
    } finally {
      await cancelQuietly(A.client, id)
    }
  })

  return { A, B, ADMIN }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
function report(fatal) {
  const pass = results.filter((r) => r.status === 'PASS').length
  const fail = results.filter((r) => r.status === 'FAIL').length
  const skipped = results.filter((r) => r.status === 'SKIP').length
  // The results file may be committed, so it never contains the project ref
  // or the test users' email addresses (the console output still does).
  const projectRef = new globalThis.URL(URL_).host.split('.')[0]
  const redact = (s) =>
    String(s)
      .replaceAll(projectRef, '<test-project>')
      .replace(/([a-z]+)\+\d+@example\.com/gi, '<test-user:$1>')
  const esc = (s) => redact(s).replace(/\|/g, '\\|').replace(/\n/g, ' ')

  console.log('\n' + '='.repeat(78) + '\nSUMMARY\n' + '='.repeat(78))
  for (const r of results) console.log(`${r.status.padEnd(4)}  ${r.id.padEnd(7)} ${r.name}`)
  console.log(`\n${pass} passed, ${fail} failed, ${skipped} skipped${fatal ? ' (run aborted)' : ''}`)

  const md = [
    '# CampusFlow API Test Results',
    '',
    `- Date: ${new Date().toISOString()}`,
    '- Project: `<test-project>.supabase.co` (from `.env.test`, anon key)',
    `- Run id: \`${TS}\``,
    `- Result: **${pass} passed, ${fail} failed, ${skipped} skipped**${fatal ? ` - run aborted: ${esc(fatal)}` : ''}`,
    '',
    '| # | Test | Result | Details (real messages) |',
    '|---|---|---|---|',
    ...results.map((r) => `| ${r.id} | ${esc(r.name)} | ${r.status === 'PASS' ? 'PASS' : `**${r.status}**`} | ${esc(r.detail)} |`),
    '',
    'Generated by `npm run test:api` (tests/api-tests.mjs).',
    '',
  ].join('\n')
  writeFileSync(join(HERE, 'TEST_RESULTS.md'), md)
  console.log('Wrote tests/TEST_RESULTS.md')
  return fail > 0 || fatal ? 1 : 0
}

let fatal = null
try {
  const users = await main()
  for (const u of Object.values(users || {})) await u.client.auth.signOut()
} catch (err) {
  fatal = err?.message || String(err)
  console.error(`\nFATAL: ${fatal}`)
}
process.exitCode = report(fatal)
