import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { Building2, ListChecks, Pencil, Plus, Save, Trash2, X } from 'lucide-react'
import { cancelBooking } from '../lib/bookings'
import { addDays, getTodayStr } from '../lib/time'

// Admin-only page. The UI is hidden for non-admins, but the real protection
// is RLS + is_admin() in the database (migration_03): a student calling these
// APIs directly gets 0 rows changed or a policy error.

const card = 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm mb-8'
const input = 'px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500'
const btn = 'px-3 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1 cursor-pointer transition-colors disabled:opacity-50'

const emptyRoom = { name: '', building: '', capacity: '' }

// ---------------------------------------------------------------------------
// Rooms: add / edit / delete
// ---------------------------------------------------------------------------
function RoomsManager({ rooms, onRoomsChanged }) {
  const [form, setForm] = useState(emptyRoom)
  const [editingId, setEditingId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const resetForm = () => {
    setForm(emptyRoom)
    setEditingId(null)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const payload = {
      name: form.name.trim(),
      building: form.building.trim(),
      capacity: Number(form.capacity),
    }
    const query = editingId
      ? supabase.from('rooms').update(payload).eq('id', editingId).select('id')
      : supabase.from('rooms').insert([payload]).select('id')
    const { data, error: err } = await query
    if (err) setError(err.message)
    else if (!data || data.length === 0) setError('Not allowed. Are you signed in as an admin?')
    else {
      resetForm()
      await onRoomsChanged()
    }
    setBusy(false)
  }

  const handleDelete = async (room) => {
    setError(null)
    // bookings.room_id is ON DELETE CASCADE. The DB blocks deleting a room
    // with upcoming confirmed bookings; here we warn about the rest.
    const { count: upcoming } = await supabase
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .eq('room_id', room.id)
      .eq('status', 'confirmed')
      .gte('date', getTodayStr())
    if (upcoming > 0) {
      setError(`"${room.name}" has ${upcoming} upcoming confirmed booking(s). Cancel them before deleting the room.`)
      return
    }
    const { count: history } = await supabase
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .eq('room_id', room.id)
    const warning = history > 0
      ? `\n\nThis will also permanently delete ${history} past/cancelled booking record(s) and the room's timetable.`
      : "\n\nThe room's timetable entries will also be deleted."
    if (!window.confirm(`Delete "${room.name}"?${warning}`)) return

    setBusy(true)
    const { data, error: err } = await supabase.from('rooms').delete().eq('id', room.id).select('id')
    if (err) setError(err.message)
    else if (!data || data.length === 0) setError('Not allowed. Are you signed in as an admin?')
    else await onRoomsChanged()
    setBusy(false)
  }

  return (
    <section className={card}>
      <div className="flex items-center gap-2 mb-4">
        <Building2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
        <h2 className="text-lg font-bold text-slate-900 dark:text-white font-display">Manage Rooms ({rooms.length})</h2>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/30 rounded-xl text-red-700 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-wrap gap-2 mb-6">
        <input required placeholder="Room name" value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })} className={`${input} flex-1 min-w-[140px]`} />
        <input required placeholder="Building" value={form.building}
          onChange={(e) => setForm({ ...form, building: e.target.value })} className={`${input} flex-1 min-w-[140px]`} />
        <input required type="number" min="1" placeholder="Capacity" value={form.capacity}
          onChange={(e) => setForm({ ...form, capacity: e.target.value })} className={`${input} w-28`} />
        <button type="submit" disabled={busy} className={`${btn} bg-emerald-600 hover:bg-emerald-700 text-white`}>
          {editingId ? <><Save className="w-3.5 h-3.5" /> Save</> : <><Plus className="w-3.5 h-3.5" /> Add room</>}
        </button>
        {editingId && (
          <button type="button" onClick={resetForm} className={`${btn} bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200`}>
            <X className="w-3.5 h-3.5" /> Cancel edit
          </button>
        )}
      </form>

      <div className="overflow-x-auto max-h-[360px]">
        <table className="w-full text-left text-sm border-collapse">
          <thead>
            <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 dark:text-slate-500 font-bold text-xs uppercase tracking-wider">
              <th className="py-2">Room</th>
              <th className="py-2">Building</th>
              <th className="py-2">Capacity</th>
              <th className="py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800/40">
            {rooms.map((r) => (
              <tr key={r.id} className="text-slate-700 dark:text-slate-300">
                <td className="py-2.5 font-semibold text-slate-900 dark:text-white">{r.name}</td>
                <td className="py-2.5 text-xs">{r.building}</td>
                <td className="py-2.5 text-xs">{r.capacity}</td>
                <td className="py-2.5 text-right space-x-2">
                  <button
                    onClick={() => {
                      setEditingId(r.id)
                      setForm({ name: r.name, building: r.building, capacity: String(r.capacity) })
                    }}
                    className={`${btn} bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200`}
                  >
                    <Pencil className="w-3.5 h-3.5" /> Edit
                  </button>
                  <button onClick={() => handleDelete(r)} disabled={busy}
                    className={`${btn} bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/30 text-red-600 dark:text-red-400`}>
                    <Trash2 className="w-3.5 h-3.5" /> Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// All bookings (admins can cancel any confirmed booking)
// ---------------------------------------------------------------------------
function AllBookings({ bookings, emailById, onChanged }) {
  const today = getTodayStr()
  const [showPast, setShowPast] = useState(false)
  const rows = bookings.filter((b) => showPast || b.date >= today)

  const handleCancel = async (id) => {
    if (!window.confirm('Cancel this booking on behalf of the user?')) return
    try {
      await cancelBooking(id)
      await onChanged()
    } catch (err) {
      alert(err.message)
    }
  }

  return (
    <section className={card}>
      <div className="flex flex-wrap justify-between items-center gap-2 mb-4">
        <div className="flex items-center gap-2">
          <ListChecks className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
          <h2 className="text-lg font-bold text-slate-900 dark:text-white font-display">All Bookings ({rows.length})</h2>
        </div>
        <label className="text-xs font-bold text-slate-500 dark:text-slate-400 flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={showPast} onChange={(e) => setShowPast(e.target.checked)} />
          Include last 30 days
        </label>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">No bookings.</p>
      ) : (
        <div className="overflow-x-auto max-h-[420px]">
          <table className="w-full text-left text-sm border-collapse">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 dark:text-slate-500 font-bold text-xs uppercase tracking-wider">
                <th className="py-2">Room</th>
                <th className="py-2">Date</th>
                <th className="py-2">Time</th>
                <th className="py-2">Booked by</th>
                <th className="py-2">Status</th>
                <th className="py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/40">
              {rows.map((b) => (
                <tr key={b.id} className="text-slate-700 dark:text-slate-300">
                  <td className="py-2.5 font-semibold text-slate-900 dark:text-white">{b.rooms?.name}</td>
                  <td className="py-2.5 font-mono text-xs">{b.date}</td>
                  <td className="py-2.5 font-mono text-xs">{b.start_time.substring(0, 5)} - {b.end_time.substring(0, 5)}</td>
                  <td className="py-2.5 text-xs">{emailById[b.booked_by] || b.booked_by.substring(0, 8)}</td>
                  <td className="py-2.5 text-xs uppercase font-bold">{b.status}</td>
                  <td className="py-2.5 text-right">
                    {b.status === 'confirmed' && b.date >= today && (
                      <button onClick={() => handleCancel(b.id)}
                        className={`${btn} bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/30 text-red-600 dark:text-red-400`}>
                        <Trash2 className="w-3.5 h-3.5" /> Cancel
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Admin page
// ---------------------------------------------------------------------------
export default function AdminPanel({ rooms, onRoomsChanged }) {
  const [bookings, setBookings] = useState([])
  const [emailById, setEmailById] = useState({})
  const [error, setError] = useState(null)

  // Bookings from the last 30 days onwards (used by the list and analytics).
  const loadBookings = useCallback(async () => {
    const since = addDays(getTodayStr(), -30)
    const { data, error: err } = await supabase
      .from('bookings')
      .select('id, room_id, date, start_time, end_time, status, booked_by, rooms(name, building)')
      .gte('date', since)
      .order('date', { ascending: false })
      .order('start_time', { ascending: true })
    if (err) setError(err.message)
    else setBookings(data || [])
  }, [])

  useEffect(() => {
    loadBookings()
    // Admins can read all profiles (RLS), so show emails instead of UUIDs.
    supabase.from('profiles').select('id, email').then(({ data }) => {
      setEmailById(Object.fromEntries((data || []).map((p) => [p.id, p.email])))
    })
    const channel = supabase
      .channel('admin-bookings')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => loadBookings())
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [loadBookings])

  return (
    <div>
      {error && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/30 rounded-2xl text-red-700 dark:text-red-400 text-sm">
          {error}
        </div>
      )}
      <AllBookings bookings={bookings} emailById={emailById} onChanged={loadBookings} />
      <RoomsManager rooms={rooms} onRoomsChanged={onRoomsChanged} />
    </div>
  )
}
