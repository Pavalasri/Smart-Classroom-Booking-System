import { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'
import { X, Calendar, Clock, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react'
import confetti from 'canvas-confetti'
import { getTodayStr, getDayOfWeek } from '../lib/time'

// Generates time slots in 30-min intervals
const generateTimeSlots = (startHour = 8, endHour = 22) => {
  const slots = []
  for (let hour = startHour; hour <= endHour; hour++) {
    const hh = String(hour).padStart(2, '0')
    slots.push(`${hh}:00`)
    if (hour !== endHour) {
      slots.push(`${hh}:30`)
    }
  }
  return slots
}

export default function BookingModal({ 
  room, 
  onClose, 
  onBookingSuccess, 
  currentUser,
  schedules = [], 
  bookings = [],
  initialStartTime = '09:00',
  initialEndTime = '10:00'
}) {
  const timeSlots = generateTimeSlots()

  const [date, setDate] = useState(getTodayStr())
  const [startTime, setStartTime] = useState(initialStartTime)
  const [endTime, setEndTime] = useState(initialEndTime)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(false)

  // Sync state if prefilled values change
  useEffect(() => {
    setStartTime(initialStartTime)
    setEndTime(initialEndTime)
  }, [initialStartTime, initialEndTime])

  useEffect(() => {
    const startIdx = timeSlots.indexOf(startTime)
    const endIdx = timeSlots.indexOf(endTime)
    if (startIdx >= endIdx && startIdx !== -1) {
      if (startIdx < timeSlots.length - 1) {
        setEndTime(timeSlots[startIdx + 1])
      }
    }
  }, [startTime])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!currentUser) {
      setError('You must be logged in to book a room.')
      return
    }

    setLoading(true)
    setError(null)

    const formattedStart = `${startTime}:00`
    const formattedEnd = `${endTime}:00`
    const bookingDow = getDayOfWeek(date)

    // 0. No bookings in the past (campus timezone). The DB trigger enforces
    //    this too; this just gives instant feedback.
    if (date < getTodayStr()) {
      setError('You cannot book a date in the past.')
      setLoading(false)
      return
    }

    // 1. Client-Side Overlap Verification
    const scheduleOverlap = schedules.find(s => 
      s.room_id === room.id && 
      Number(s.day_of_week) === bookingDow && 
      s.start_time < formattedEnd && 
      s.end_time > formattedStart
    )

    if (scheduleOverlap) {
      setError(`Overlaps with recurring class: ${scheduleOverlap.course_name} (${scheduleOverlap.start_time.substring(0, 5)} - ${scheduleOverlap.end_time.substring(0, 5)})`)
      setLoading(false)
      return
    }

    const bookingOverlap = bookings.find(b => 
      b.room_id === room.id && 
      b.date === date && 
      b.status === 'confirmed' && 
      b.start_time < formattedEnd && 
      b.end_time > formattedStart
    )

    if (bookingOverlap) {
      setError(`Overlaps with an existing booking (${bookingOverlap.start_time.substring(0, 5)} - ${bookingOverlap.end_time.substring(0, 5)})`)
      setLoading(false)
      return
    }

    try {
      // 2. Perform DB Insertion
      const { error: dbError } = await supabase
        .from('bookings')
        .insert([
          {
            room_id: room.id,
            date,
            start_time: formattedStart,
            end_time: formattedEnd,
            booked_by: currentUser.id,
            status: 'confirmed'
          }
        ])
        .select()

      if (dbError) throw dbError

      setSuccess(true)
      
      confetti({
        particleCount: 80,
        spread: 60,
        origin: { y: 0.7 }
      })

      setTimeout(() => {
        onBookingSuccess()
        onClose()
      }, 1500)

    } catch (err) {
      setError(err.message || 'Database error: Could not confirm the booking.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        onClick={onClose} 
        className="absolute inset-0 bg-slate-900/60 dark:bg-slate-950/80 backdrop-blur-sm transition-opacity"
      ></div>

      {/* Modal Card */}
      <div className="relative w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-100 p-6 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 transition-colors">
        
        {/* Header bar */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 to-teal-600"></div>

        {/* Close Button */}
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        <h3 className="text-xl font-bold font-display text-slate-900 dark:text-white mb-1">
          Book Classroom
        </h3>
        <p className="text-sm text-emerald-600 dark:text-emerald-400 font-bold mb-6">
          {room.name} — {room.building} (Cap: {room.capacity})
        </p>

        {error && (
          <div className="mb-5 p-4 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/30 rounded-xl text-red-700 dark:text-red-400 text-sm flex items-start gap-2.5">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-red-500" />
            <div>
              <strong className="font-semibold block">Booking Blocked</strong>
              {error}
            </div>
          </div>
        )}

        {success && (
          <div className="mb-5 p-4 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/30 rounded-xl text-emerald-700 dark:text-emerald-400 text-sm flex items-start gap-2.5">
            <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5 text-emerald-600" />
            <div>
              <strong className="font-semibold block">Booking Confirmed!</strong>
              Successfully reserved {room.name}. Closing...
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Date Picker */}
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-2">
              Select Date
            </label>
            <div className="relative">
              <Calendar className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 pointer-events-none" />
              <input
                type="date"
                required
                min={getTodayStr()}
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full pl-11 pr-4 py-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all text-sm text-slate-900 dark:text-white"
              />
            </div>
          </div>

          {/* Time Picker Row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-2">
                Start Time
              </label>
              <div className="relative">
                <Clock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                <select
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all text-sm cursor-pointer text-slate-900 dark:text-white"
                >
                  {timeSlots.slice(0, -1).map((time) => (
                    <option key={time} value={time} className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">
                      {time}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-2">
                End Time
              </label>
              <div className="relative">
                <Clock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                <select
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all text-sm cursor-pointer text-slate-900 dark:text-white"
                >
                  {timeSlots.map((time) => {
                    const startIdx = timeSlots.indexOf(startTime)
                    const thisIdx = timeSlots.indexOf(time)
                    if (thisIdx <= startIdx) return null
                    return (
                      <option key={time} value={time} className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">
                        {time}
                      </option>
                    )
                  })}
                </select>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-semibold rounded-xl text-sm transition-all duration-200 cursor-pointer text-center"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || success}
              className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl text-sm transition-all duration-200 flex items-center justify-center gap-2 shadow-md shadow-emerald-600/10 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                'Confirm Booking'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
