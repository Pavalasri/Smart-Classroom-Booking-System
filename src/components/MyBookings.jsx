import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { CalendarDays, History, Trash2, Loader2 } from 'lucide-react'
import { cancelBooking, isUpcoming } from '../lib/bookings'
import { getTodayStr, getCurrentTimeStr } from '../lib/time'

const StatusBadge = ({ status }) => (
  <span
    className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider border ${
      status === 'confirmed'
        ? 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900/30'
        : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700'
    }`}
  >
    {status}
  </span>
)

function BookingTable({ rows, onCancel, cancellingId, emptyText }) {
  if (rows.length === 0) {
    return <p className="text-sm text-slate-500 dark:text-slate-400 py-4">{emptyText}</p>
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm border-collapse">
        <thead>
          <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 dark:text-slate-500 font-bold text-xs uppercase tracking-wider">
            <th className="py-2.5">Room</th>
            <th className="py-2.5">Building</th>
            <th className="py-2.5">Date</th>
            <th className="py-2.5">Time</th>
            <th className="py-2.5">Status</th>
            {onCancel && <th className="py-2.5 text-right">Actions</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/40">
          {rows.map((b) => (
            <tr key={b.id} className="text-slate-700 dark:text-slate-300">
              <td className="py-3 font-semibold text-slate-900 dark:text-white">{b.rooms?.name}</td>
              <td className="py-3 text-slate-500 dark:text-slate-400 text-xs">{b.rooms?.building}</td>
              <td className="py-3 font-mono text-xs">{b.date}</td>
              <td className="py-3 font-mono text-xs font-bold">
                {b.start_time.substring(0, 5)} - {b.end_time.substring(0, 5)}
              </td>
              <td className="py-3"><StatusBadge status={b.status} /></td>
              {onCancel && (
                <td className="py-3 text-right">
                  {b.status === 'confirmed' && (
                    <button
                      onClick={() => onCancel(b.id)}
                      disabled={cancellingId === b.id}
                      className="px-2.5 py-1.5 bg-red-50 dark:bg-red-950/20 hover:bg-red-100 dark:hover:bg-red-900/30 border border-red-200 dark:border-red-900/30 text-red-600 dark:text-red-400 text-xs font-bold rounded-lg transition-colors cursor-pointer inline-flex items-center gap-1 disabled:opacity-50"
                    >
                      {cancellingId === b.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      Cancel
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// "My Bookings" page: the signed-in user's upcoming and past bookings.
export default function MyBookings({ user }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [cancellingId, setCancellingId] = useState(null)

  const load = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('bookings')
      .select('id, date, start_time, end_time, status, rooms(name, building)')
      .eq('booked_by', user.id)
      .order('date', { ascending: true })
      .order('start_time', { ascending: true })
    if (err) setError(err.message)
    else {
      setError(null)
      setRows(data || [])
    }
    setLoading(false)
  }, [user.id])

  // Initial load + live updates for this user's bookings only.
  useEffect(() => {
    load()
    const channel = supabase
      .channel(`my-bookings-${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bookings', filter: `booked_by=eq.${user.id}` },
        () => load()
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [load, user.id])

  const handleCancel = async (id) => {
    if (!window.confirm('Are you sure you want to cancel this booking?')) return
    setCancellingId(id)
    try {
      await cancelBooking(id)
      await load()
    } catch (err) {
      alert(err.message)
    } finally {
      setCancellingId(null)
    }
  }

  const today = getTodayStr()
  const now = getCurrentTimeStr()
  const upcoming = rows.filter((b) => isUpcoming(b, today, now))
  // Most recent past bookings first.
  const past = rows.filter((b) => !isUpcoming(b, today, now)).reverse()

  const card = 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm mb-8'

  if (loading) {
    return <p className="text-sm text-slate-500 dark:text-slate-400 py-12 text-center">Loading your bookings...</p>
  }

  return (
    <div>
      {error && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/30 rounded-2xl text-red-700 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      <section className={card}>
        <div className="flex items-center gap-2 mb-4">
          <CalendarDays className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
          <h2 className="text-lg font-bold text-slate-900 dark:text-white font-display">
            Upcoming ({upcoming.length})
          </h2>
        </div>
        <BookingTable
          rows={upcoming}
          onCancel={handleCancel}
          cancellingId={cancellingId}
          emptyText="No upcoming bookings. Book a room from the Dashboard."
        />
      </section>

      <section className={card}>
        <div className="flex items-center gap-2 mb-4">
          <History className="w-5 h-5 text-slate-500 dark:text-slate-400" />
          <h2 className="text-lg font-bold text-slate-900 dark:text-white font-display">
            Past ({past.length})
          </h2>
        </div>
        <BookingTable rows={past} emptyText="No past bookings yet." />
      </section>
    </div>
  )
}
