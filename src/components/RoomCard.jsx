import { Users, Plus, MapPin } from 'lucide-react'
import { getDayOfWeek } from '../lib/time'

export default function RoomCard({ 
  room, 
  schedules = [], 
  bookings = [], 
  selectedDate, 
  selectedTime, 
  onBookClick 
}) {
  const dayOfWeek = getDayOfWeek(selectedDate) // 0 = Sunday, 6 = Saturday

  const isTimeInRange = (time, start, end) => {
    return time >= start && time < end
  }

  // 1. Find active schedule (recurring class) for the selected day of week & time
  const activeSchedule = schedules.find(s => 
    s.room_id === room.id && 
    Number(s.day_of_week) === dayOfWeek && 
    isTimeInRange(selectedTime, s.start_time, s.end_time)
  )

  // 2. Find active booking (ad-hoc) for the selected date & time
  const activeBooking = bookings.find(b => 
    b.room_id === room.id && 
    b.date === selectedDate && 
    b.status === 'confirmed' && 
    isTimeInRange(selectedTime, b.start_time, b.end_time)
  )

  let status = 'vacant'
  if (activeSchedule) status = 'occupied'
  else if (activeBooking) status = 'booked'

  const getStatusBadge = () => {
    switch (status) {
      case 'occupied':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-red-100 dark:bg-red-950/40 text-red-800 dark:text-red-300 border border-red-200 dark:border-red-900/30">
            <span className="w-1 h-1 rounded-full bg-red-500 animate-pulse"></span>
            Occupied
          </span>
        )
      case 'booked':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-900/30">
            <span className="w-1 h-1 rounded-full bg-amber-500"></span>
            Booked
          </span>
        )
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-100 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900/30">
            <span className="w-1 h-1 rounded-full bg-emerald-500"></span>
            Vacant
          </span>
        )
    }
  }

  return (
    <div className="w-[260px] min-w-[260px] bg-white dark:bg-slate-900 py-3 px-4 flex flex-col justify-between border-r border-b border-slate-200 dark:border-slate-800 sticky left-0 z-20 shadow-[4px_0_8px_-4px_rgba(0,0,0,0.03)] dark:shadow-[4px_0_8px_-4px_rgba(0,0,0,0.2)] h-full transition-colors">
      <div>
        <div className="flex justify-between items-start gap-1">
          <div className="truncate">
            <h3 className="text-sm font-extrabold text-slate-900 dark:text-white font-display tracking-tight leading-snug truncate" title={room.name}>
              {room.name}
            </h3>
            <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider flex items-center gap-0.5 mt-0.5 truncate">
              <MapPin className="w-2.5 h-2.5 shrink-0" />
              {room.building}
            </span>
          </div>
          <div className="shrink-0">
            {getStatusBadge()}
          </div>
        </div>

        <div className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400 mt-1.5">
          <Users className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span>Capacity: <strong className="text-slate-700 dark:text-slate-300">{room.capacity} seats</strong></span>
        </div>
      </div>

      <button
        onClick={() => onBookClick(room)}
        className="w-full py-1.5 px-3 bg-emerald-50 dark:bg-emerald-950/30 hover:bg-emerald-600 dark:hover:bg-emerald-700 border border-emerald-200 dark:border-emerald-800/60 hover:border-emerald-500 dark:hover:border-emerald-500 text-emerald-700 dark:text-emerald-400 hover:text-white dark:hover:text-white font-bold rounded-lg text-[11px] transition-all duration-200 flex items-center justify-center gap-1 cursor-pointer mt-2"
      >
        <Plus className="w-3.5 h-3.5" />
        Book Room
      </button>
    </div>
  )
}
