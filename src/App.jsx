import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'
import Navbar from './components/Navbar'
import RoomCard from './components/RoomCard'
import BookingModal from './components/BookingModal'
import Auth from './components/Auth'
import { 
  Clock, 
  Layers, 
  Play, 
  Pause,
  AlertCircle,
  CalendarDays,
  Trash2,
  Users,
  X
} from 'lucide-react'

// Helper to convert minutes from midnight to HH:MM:SS
const minutesToTimeStr = (minutes) => {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:05` // 05s to bypass strict overlaps if exact comparisons are made
}

// Helper to convert HH:MM:SS to minutes from midnight
const timeStrToMinutes = (timeStr) => {
  if (!timeStr) return 540 // default 9:00 AM
  const parts = timeStr.split(':')
  return Number(parts[0]) * 60 + Number(parts[1])
}

// Helper to format time string nicely
const formatTimeLabel = (timeStr) => {
  if (!timeStr) return ''
  const [h, m] = timeStr.split(':')
  const hours = Number(h)
  const ampm = hours >= 12 ? 'PM' : 'AM'
  const displayHours = hours % 12 || 12
  return `${displayHours}:${m} ${ampm}`
}

// Map hour index to timeline labels
const timelineHours = [
  '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', 
  '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', 
  '20:00', '21:00', '22:00'
]

// Convert booking/schedule times to percentage widths
const timeToPercent = (timeStr) => {
  if (!timeStr) return 0
  const [h, m] = timeStr.split(':').map(Number)
  const minutes = h * 60 + m
  const startMinutes = 480  // 08:00 AM
  const endMinutes = 1320   // 10:00 PM
  
  const clamped = Math.max(startMinutes, Math.min(endMinutes, minutes))
  return ((clamped - startMinutes) / (endMinutes - startMinutes)) * 100
}

export default function App() {
  const [user, setUser] = useState(null)
  const [showAuthModal, setShowAuthModal] = useState(false)
  const [darkMode, setDarkMode] = useState(false)

  const [rooms, setRooms] = useState([])
  const [schedules, setSchedules] = useState([])
  const [bookings, setBookings] = useState([])
  const [myBookings, setMyBookings] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [selectedBuilding, setSelectedBuilding] = useState('All')
  
  const getTodayStr = () => {
    const today = new Date()
    const yyyy = today.getFullYear()
    const mm = String(today.getMonth() + 1).padStart(2, '0')
    const dd = String(today.getDate()).padStart(2, '0')
    return `${yyyy}-${mm}-${dd}`
  }
  const [selectedDate, setSelectedDate] = useState(getTodayStr())

  const getCurrentTimeStr = () => {
    const now = new Date()
    const h = String(now.getHours()).padStart(2, '0')
    const m = String(now.getMinutes()).padStart(2, '0')
    return `${h}:${m}:00`
  }
  
  const [selectedTime, setSelectedTime] = useState(getCurrentTimeStr())
  const [syncWithTime, setSyncWithTime] = useState(true)

  // Booking Modal prefills
  const [bookingRoom, setBookingRoom] = useState(null)
  const [prefilledStart, setPrefilledStart] = useState('09:00')
  const [prefilledEnd, setPrefilledEnd] = useState('10:00')

  // Theme Sync effect
  useEffect(() => {
    if (darkMode) {
      document.body.classList.add('dark')
    } else {
      document.body.classList.remove('dark')
    }
  }, [darkMode])

  // Get active session
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      if (session?.user) {
        setShowAuthModal(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  // Auto time synchronization
  useEffect(() => {
    if (!syncWithTime) return
    setSelectedTime(getCurrentTimeStr())
    const interval = setInterval(() => {
      setSelectedTime(getCurrentTimeStr())
    }, 15000)
    return () => clearInterval(interval)
  }, [syncWithTime])

  // Fetch initial dashboard structures
  const fetchData = async () => {
    setLoading(true)
    setError(null)
    try {
      const { data: roomsData, error: roomsErr } = await supabase
        .from('rooms')
        .select('*')
        .order('name')
      if (roomsErr) throw roomsErr
      setRooms(roomsData || [])

      const { data: schedulesData, error: schedulesErr } = await supabase
        .from('schedules')
        .select('*')
      if (schedulesErr) throw schedulesErr
      setSchedules(schedulesData || [])

      await fetchBookingsForDate(selectedDate)

    } catch (err) {
      setError(err.message || 'Error loading dashboard data.')
    } finally {
      setLoading(false)
    }
  }

  // Fetch bookings matching active date
  const fetchBookingsForDate = async (dateStr) => {
    try {
      const { data: bookingsData, error: bookingsErr } = await supabase
        .from('bookings')
        .select('*')
        .eq('date', dateStr)
        .eq('status', 'confirmed')
      if (bookingsErr) throw bookingsErr
      setBookings(bookingsData || [])
    } catch (err) {
      console.error('Error fetching bookings:', err)
    }
  }

  // Fetch all user bookings for the "My Bookings" list
  const fetchMyBookings = async () => {
    if (!user) {
      setMyBookings([])
      return
    }
    try {
      const { data, error } = await supabase
        .from('bookings')
        .select('*, rooms(name, building)')
        .eq('booked_by', user.id)
        .eq('status', 'confirmed')
        .order('date')
        .order('start_time')
      if (error) throw error
      setMyBookings(data || [])
    } catch (err) {
      console.error('Error fetching user bookings:', err)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  useEffect(() => {
    fetchBookingsForDate(selectedDate)
  }, [selectedDate])

  // Sync My Bookings list dynamically
  useEffect(() => {
    fetchMyBookings()
  }, [user, bookings])

  // Realtime subscription setup
  useEffect(() => {
    const channel = supabase
      .channel('bookings-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bookings' },
        async (payload) => {
          await fetchBookingsForDate(selectedDate)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [selectedDate])

  const handleBookClick = (room) => {
    if (!user) {
      setShowAuthModal(true)
    } else {
      setPrefilledStart('09:00')
      setPrefilledEnd('10:00')
      setBookingRoom(room)
    }
  }

  // Click Timeline cell directly to book pre-filled hours
  const handleTimelineClick = (e, room) => {
    // If user clicked inside an existing colored capsule, ignore
    if (e.target.closest('.group\\/item')) return

    if (!user) {
      setShowAuthModal(true)
      return
    }

    const rect = e.currentTarget.querySelector('.relative-timeline-container').getBoundingClientRect()
    const clickX = e.clientX - rect.left
    const width = rect.width
    const pct = Math.max(0, Math.min(1, clickX / width))

    const totalMinutes = 840 // 08:00 AM to 10:00 PM
    const clickedMinutes = 480 + pct * totalMinutes

    // Round click to the nearest 30 mins
    const roundedMins = Math.round(clickedMinutes / 30) * 30
    const startHourStr = minutesToTimeStr(roundedMins).substring(0, 5)
    const endHourStr = minutesToTimeStr(roundedMins + 60).substring(0, 5)

    setPrefilledStart(startHourStr)
    setPrefilledEnd(endHourStr)
    setBookingRoom(room)
  }

  const handleCancelBooking = async (bookingId) => {
    if (!window.confirm('Are you sure you want to cancel this booking?')) return

    try {
      const { error: cancelErr } = await supabase
        .from('bookings')
        .update({ status: 'cancelled' })
        .eq('id', bookingId)

      if (cancelErr) throw cancelErr

      setBookings(prev => prev.filter(b => b.id !== bookingId))
    } catch (err) {
      alert(err.message || 'Could not cancel booking.')
    }
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    setUser(null)
  }

  const buildings = Array.from(new Set(rooms.map((r) => r.building)))
  
  const filteredRooms = rooms.filter((r) => {
    return selectedBuilding === 'All' || r.building === selectedBuilding
  })

  const dayOfWeek = new Date(selectedDate).getDay()
  const isTimeInRange = (time, start, end) => time >= start && time < end

  // Calculate live counts
  const roomStatusSummary = filteredRooms.reduce(
    (acc, room) => {
      const activeSchedule = schedules.find(
        (s) =>
          s.room_id === room.id &&
          Number(s.day_of_week) === dayOfWeek &&
          isTimeInRange(selectedTime, s.start_time, s.end_time)
      )
      const activeBooking = bookings.find(
        (b) =>
          b.room_id === room.id &&
          b.date === selectedDate &&
          b.status === 'confirmed' &&
          isTimeInRange(selectedTime, b.start_time, b.end_time)
      )

      if (activeSchedule) acc.occupied += 1
      else if (activeBooking) acc.booked += 1
      else acc.vacant += 1

      return acc
    },
    { vacant: 0, occupied: 0, booked: 0 }
  )

  const timeSliderVal = timeStrToMinutes(selectedTime)
  
  const handleSliderChange = (e) => {
    setSyncWithTime(false)
    const mins = Number(e.target.value)
    setSelectedTime(minutesToTimeStr(mins))
  }

  // Calculate vertical Live Line indicator position
  const getLivePercent = () => {
    const now = new Date()
    const currentMins = now.getHours() * 60 + now.getMinutes()
    const start = 480  // 08:00 AM
    const end = 1320   // 10:00 PM
    if (currentMins < start || currentMins > end) return null
    return ((currentMins - start) / (end - start)) * 100
  }

  return (
    <div className={`min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100 font-sans selection:bg-emerald-500/10 selection:text-emerald-700 transition-colors duration-250`}>
      
      {/* Navbar */}
      <Navbar
        user={user}
        onLogout={handleLogout}
        selectedBuilding={selectedBuilding}
        setSelectedBuilding={setSelectedBuilding}
        selectedDate={selectedDate}
        setSelectedDate={setSelectedDate}
        buildings={buildings}
        darkMode={darkMode}
        toggleDarkMode={() => setDarkMode(!darkMode)}
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        
        {/* Error Banner */}
        {error && (
          <div className="mb-8 p-4 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/30 rounded-2xl text-red-700 dark:text-red-400 text-sm flex items-center gap-3">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <span>{error}</span>
            <button 
              onClick={fetchData} 
              className="ml-auto text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 cursor-pointer"
            >
              Retry
            </button>
          </div>
        )}

        {/* Time Explorer Control Panel */}
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 md:p-8 shadow-sm mb-8 relative overflow-hidden transition-colors">
          <div className="flex flex-col lg:flex-row justify-between items-stretch lg:items-center gap-8">
            
            {/* Left Slider controller */}
            <div className="flex-1 space-y-4">
              <div className="flex flex-wrap justify-between items-center gap-2">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-emerald-50 dark:bg-emerald-950/30 rounded-xl border border-emerald-100 dark:border-emerald-900/20">
                    <Clock className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-slate-900 dark:text-white font-display">Timeline Time Explorer</h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">Scrub the slider to view vacancies at different hours</p>
                  </div>
                </div>

                <button
                  onClick={() => setSyncWithTime(!syncWithTime)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold transition-all duration-200 cursor-pointer ${
                    syncWithTime 
                      ? 'bg-emerald-600 border-emerald-500 text-white shadow-md shadow-emerald-500/10'
                      : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-350 hover:text-slate-800 dark:hover:text-white'
                  }`}
                >
                  {syncWithTime ? (
                    <>
                      <Play className="w-3.5 h-3.5 animate-spin text-white" />
                      Live Sync On
                    </>
                  ) : (
                    <>
                      <Pause className="w-3.5 h-3.5" />
                      Live Sync Paused
                    </>
                  )}
                </button>
              </div>

              {/* Slider Input track */}
              <div className="flex items-center gap-4 bg-slate-50 dark:bg-slate-950 p-4 rounded-2xl border border-slate-100 dark:border-slate-850">
                <span className="text-xs font-bold text-slate-500 dark:text-slate-400 font-mono">08:00 AM</span>
                <input
                  type="range"
                  min="480"
                  max="1320"
                  step="30"
                  value={timeSliderVal}
                  onChange={handleSliderChange}
                  className="flex-1 accent-emerald-600 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg appearance-none cursor-pointer focus:outline-none"
                />
                <span className="text-xs font-bold text-slate-500 dark:text-slate-400 font-mono">10:00 PM</span>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-sm font-bold text-slate-600 dark:text-slate-400">
                  Target Time:
                </span>
                <span className="text-lg font-bold font-mono text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/30 px-3 py-1 rounded-xl shadow-inner">
                  {formatTimeLabel(selectedTime)}
                </span>
              </div>
            </div>

            {/* Right: Occupancy Statistics */}
            <div className="grid grid-cols-3 gap-3 md:gap-4 lg:w-[420px] bg-slate-50 dark:bg-slate-950 p-5 rounded-2xl border border-slate-100 dark:border-slate-850">
              <div className="flex flex-col items-center text-center p-3 bg-emerald-500/5 border border-emerald-500/10 rounded-xl">
                <span className="text-xs font-bold text-slate-500 dark:text-slate-400">Vacant</span>
                <span className="text-3xl font-extrabold text-emerald-600 dark:text-emerald-400 mt-1 font-display">
                  {loading ? '—' : roomStatusSummary.vacant}
                </span>
                <span className="text-[10px] text-emerald-600/70 dark:text-emerald-400/70 uppercase font-bold tracking-wider mt-1">Rooms</span>
              </div>

              <div className="flex flex-col items-center text-center p-3 bg-red-500/5 border border-red-500/10 rounded-xl">
                <span className="text-xs font-bold text-slate-500 dark:text-slate-400">In Class</span>
                <span className="text-3xl font-extrabold text-red-600 dark:text-red-400 mt-1 font-display">
                  {loading ? '—' : roomStatusSummary.occupied}
                </span>
                <span className="text-[10px] text-red-600/70 dark:text-red-400/70 uppercase font-bold tracking-wider mt-1">Occupied</span>
              </div>

              <div className="flex flex-col items-center text-center p-3 bg-amber-500/5 border border-amber-500/10 rounded-xl">
                <span className="text-xs font-bold text-slate-500 dark:text-slate-400">Booked</span>
                <span className="text-3xl font-extrabold text-amber-500 dark:text-amber-400 mt-1 font-display">
                  {loading ? '—' : roomStatusSummary.booked}
                </span>
                <span className="text-[10px] text-amber-600/70 dark:text-amber-400/70 uppercase font-bold tracking-wider mt-1">Ad-hoc</span>
              </div>
            </div>

          </div>
        </section>

        {/* My Bookings Central Panel Card */}
        {user && myBookings.length > 0 && (
          <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm mb-8 transition-colors">
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center gap-2">
                <CalendarDays className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                <h2 className="text-lg font-bold text-slate-900 dark:text-white font-display">
                  My Reservations ({myBookings.length})
                </h2>
              </div>
              <span className="text-xs font-semibold text-slate-400 dark:text-slate-500">Upcoming reserves</span>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm border-collapse">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 dark:text-slate-500 font-bold text-xs uppercase tracking-wider">
                    <th className="py-2.5">Room</th>
                    <th className="py-2.5">Building</th>
                    <th className="py-2.5">Date</th>
                    <th className="py-2.5">Time Slot</th>
                    <th className="py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/40">
                  {myBookings.map((b) => (
                    <tr key={b.id} className="text-slate-700 dark:text-slate-300 hover:bg-slate-50/50 dark:hover:bg-slate-950/20">
                      <td className="py-3 font-semibold text-slate-900 dark:text-white">
                        {b.rooms?.name}
                      </td>
                      <td className="py-3 text-slate-500 dark:text-slate-400 text-xs">
                        {b.rooms?.building}
                      </td>
                      <td className="py-3 font-mono text-xs">{b.date}</td>
                      <td className="py-3 font-mono text-emerald-600 dark:text-emerald-400 font-bold text-xs">
                        {b.start_time.substring(0, 5)} - {b.end_time.substring(0, 5)}
                      </td>
                      <td className="py-3 text-right">
                        <button
                          onClick={() => handleCancelBooking(b.id)}
                          className="px-2.5 py-1.5 bg-red-50 dark:bg-red-950/20 hover:bg-red-100 dark:hover:bg-red-900/30 border border-red-200 dark:border-red-900/30 text-red-600 dark:text-red-400 text-xs font-bold rounded-lg transition-colors cursor-pointer inline-flex items-center gap-1"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Cancel
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Dashboard Grid Header */}
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-slate-500 dark:text-slate-400" />
            <h2 className="text-lg font-bold font-display text-slate-900 dark:text-white">
              Timetable Scheduler Grid ({filteredRooms.length})
            </h2>
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
            <CalendarDays className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span>Viewing: <strong className="text-slate-800 dark:text-slate-200">{selectedDate}</strong></span>
          </div>
        </div>

        {/* Loading Spinner */}
        {loading ? (
          <div className="flex flex-col justify-center items-center py-24 gap-4">
            <RefreshCwIcon className="w-10 h-10 animate-spin text-emerald-600" />
            <p className="text-slate-500 dark:text-slate-400 font-bold text-sm">Synchronizing with Supabase...</p>
          </div>
        ) : filteredRooms.length === 0 ? (
          <div className="text-center py-20 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-sm">
            <p className="text-slate-500 dark:text-slate-400 text-sm">No classrooms found. Try modifying your filters.</p>
          </div>
        ) : (
          /* TIMETABLE GRID VIEW */
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden transition-colors">
            
            {/* Scrollable grid area with max-height for persistent scrollbar */}
            <div className="overflow-auto max-h-[500px]">
              <div className="min-w-[1100px] flex flex-col">
                
                {/* 1. Timeline Hours Ruler Header - Sticky top-0 */}
                <div className="flex border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 sticky top-0 z-30 shadow-[0_1px_2px_rgba(0,0,0,0.05)] transition-colors">
                  {/* Left Column Spacer matching RoomCard width - Sticky left-0 & top-0 */}
                  <div className="w-[260px] min-w-[260px] p-4 font-bold text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 border-r border-slate-200 dark:border-slate-800 sticky left-0 top-0 z-40 bg-slate-50 dark:bg-slate-950 transition-colors">
                    Classroom
                  </div>
                  
                  {/* Ruler Columns wrapped in px-6 for exact padding alignment */}
                  <div className="flex-1 px-6 bg-slate-50 dark:bg-slate-950 h-12 transition-colors">
                    <div className="flex relative h-full w-full">
                      {timelineHours.map((hour, idx) => {
                        const pct = (idx / (timelineHours.length - 1)) * 100
                        return (
                          <div 
                            key={hour} 
                            className="absolute -translate-x-1/2 flex flex-col items-center justify-end pb-1 h-full text-[10px] font-bold text-slate-400 dark:text-slate-500 font-mono"
                            style={{ left: `${pct}%` }}
                          >
                            <span>{hour}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>

                {/* 2. Room Rows */}
                <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
                  {filteredRooms.map((room, roomIdx) => {
                    // Filter schedules and bookings for this room for the timeline
                    const todaySchedules = schedules
                      .filter(s => s.room_id === room.id && Number(s.day_of_week) === dayOfWeek)
                      .map(s => ({
                        id: s.id,
                        name: s.course_name,
                        start: s.start_time,
                        end: s.end_time,
                        type: 'class'
                      }))

                    const todayBookings = bookings
                      .filter(b => b.room_id === room.id && b.date === selectedDate && b.status === 'confirmed')
                      .map(b => ({
                        id: b.id,
                        name: 'Booked Slot',
                        start: b.start_time,
                        end: b.end_time,
                        booked_by: b.booked_by,
                        type: 'booking'
                      }))

                    const rowEvents = [...todaySchedules, ...todayBookings]

                    return (
                      <div key={room.id} className="flex h-[115px] relative hover:bg-slate-50/50 dark:hover:bg-slate-950/10 transition-colors">
                        
                        {/* Sticky left card details */}
                        <RoomCard
                          room={room}
                          schedules={schedules}
                          bookings={bookings}
                          selectedDate={selectedDate}
                          selectedTime={selectedTime}
                          onBookClick={handleBookClick}
                        />

                        {/* Interactive timeline lane padded px-6 with direct click-to-book */}
                        <div 
                          onClick={(e) => handleTimelineClick(e, room)}
                          className={`flex-1 h-full px-6 cursor-pointer ${
                            roomIdx % 2 === 0 ? 'bg-white dark:bg-slate-900' : 'bg-slate-50/40 dark:bg-slate-950/20'
                          }`}
                        >
                          <div className="relative w-full h-full flex items-center relative-timeline-container">
                            
                            {/* Underlay Hour Grid Lines */}
                            <div className="absolute inset-0 flex">
                              {timelineHours.map((hour, idx) => {
                                const pct = (idx / (timelineHours.length - 1)) * 100
                                return (
                                  <div 
                                    key={`line-${hour}`}
                                    className="absolute top-0 bottom-0 border-l border-slate-200/60 dark:border-slate-800/40"
                                    style={{ left: `${pct}%` }}
                                  ></div>
                                )
                              })}
                            </div>

                            {/* Live Time Red Line (Only on today's view) */}
                            {selectedDate === getTodayStr() && getLivePercent() !== null && (
                              <div 
                                className="live-time-line" 
                                style={{ left: `${getLivePercent()}%` }}
                              >
                                <div className="live-time-dot"></div>
                              </div>
                            )}

                            {/* Event Capsules Overlay */}
                            {rowEvents.map((evt) => {
                              const isUserBooking = evt.type === 'booking' && evt.booked_by === user?.id
                              const leftPos = timeToPercent(evt.start)
                              const rightPos = timeToPercent(evt.end)
                              const widthPercent = Math.max(2, rightPos - leftPos) // min 2% width

                              return (
                                <div
                                  key={evt.id}
                                  className={`absolute h-12 rounded-xl border px-3 flex flex-col justify-center select-none shadow-sm overflow-hidden group/item transition-all duration-150 ${
                                    evt.type === 'class'
                                      ? 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900/30 text-red-800 dark:text-red-300'
                                      : isUserBooking
                                        ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800/40 text-emerald-800 dark:text-emerald-300 ring-2 ring-emerald-500/10'
                                        : 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/30 text-amber-800 dark:text-amber-300'
                                  }`}
                                  style={{
                                    left: `${leftPos}%`,
                                    width: `${widthPercent}%`
                                  }}
                                  title={`${evt.name} (${evt.start.substring(0, 5)} - ${evt.end.substring(0, 5)})`}
                                >
                                  <span className="text-xs font-extrabold truncate block leading-tight">
                                    {evt.name}
                                  </span>
                                  <span className="text-[9px] font-mono opacity-80 mt-0.5 font-bold block">
                                    {evt.start.substring(0, 5)} - {evt.end.substring(0, 5)}
                                  </span>

                                  {/* User cancellation control overlay */}
                                  {evt.type === 'booking' && evt.booked_by === user?.id && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        handleCancelBooking(evt.id)
                                      }}
                                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-800 border border-red-205 dark:border-red-700 text-red-600 dark:text-red-400 rounded-lg opacity-0 group-hover/item:opacity-100 transition-opacity z-20 cursor-pointer shadow-sm"
                                      title="Cancel Booking"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>
                              )
                            })}

                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>

              </div>
            </div>

            {/* Bottom Legend */}
            <div className="bg-slate-50 dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 px-6 py-4 flex flex-wrap gap-6 text-xs font-bold text-slate-500 dark:text-slate-400 transition-colors">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/30"></span>
                Scheduled Class
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/30"></span>
                Ad-hoc Booking (Other)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/30"></span>
                Your Confirmed Booking
              </span>
            </div>

          </div>
        )}
      </main>

      {/* Guest Login Modal */}
      {showAuthModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div 
            onClick={() => setShowAuthModal(false)}
            className="absolute inset-0 bg-slate-900/60 dark:bg-slate-950/80 backdrop-blur-sm"
          ></div>
          <div className="relative w-full max-w-md z-10">
            <button 
              onClick={() => setShowAuthModal(false)}
              className="absolute top-6 right-6 p-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white transition-colors cursor-pointer z-50"
            >
              <X className="w-4 h-4" />
            </button>
            <Auth onAuthSuccess={(usr) => {
              setUser(usr)
              setShowAuthModal(false)
            }} />
          </div>
        </div>
      )}

      {/* Booking Form Modal */}
      {bookingRoom && (
        <BookingModal
          room={bookingRoom}
          currentUser={user}
          schedules={schedules}
          bookings={bookings}
          initialStartTime={prefilledStart}
          initialEndTime={prefilledEnd}
          onClose={() => setBookingRoom(null)}
          onBookingSuccess={async () => {
            await fetchBookingsForDate(selectedDate)
          }}
        />
      )}

      {/* Footer */}
      <footer className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 py-8 text-center text-xs text-slate-500 dark:text-slate-400 mt-20 transition-colors">
        <p>© 2026 CampusFlow Systems. Designed for University Registrars and Students.</p>
      </footer>
    </div>
  )
}

function RefreshCwIcon({ className }) {
  return (
    <svg 
      className={className} 
      fill="none" 
      stroke="currentColor" 
      viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 8H18" />
    </svg>
  )
}
