import { LogOut, Calendar, Building2, User, Landmark, Sun, Moon } from 'lucide-react'

export default function Navbar({ 
  user,
  isAdmin,
  onLogout, 
  selectedBuilding, 
  setSelectedBuilding, 
  selectedDate, 
  setSelectedDate,
  buildings,
  darkMode,
  toggleDarkMode
}) {
  return (
    <nav className="sticky top-0 z-40 w-full border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md px-6 py-4 flex flex-col md:flex-row justify-between items-center gap-4 text-slate-800 dark:text-slate-100 shadow-sm transition-colors">
      {/* Brand Logo */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-gradient-to-tr from-emerald-500 to-teal-600 rounded-xl shadow-md shadow-emerald-500/10">
          <Landmark className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-lg font-bold font-display tracking-tight text-slate-900 dark:text-white leading-none">
            CampusFlow
          </h1>
          <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold uppercase tracking-wider mt-0.5">
            Classroom Booking Hub
          </p>
        </div>
      </div>

      {/* Filters (Date + Building) + Theme Toggle */}
      <div className="flex flex-wrap items-center gap-4">
        {/* Date Selector */}
        <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3.5 py-2 text-sm text-slate-700 dark:text-slate-300 focus-within:ring-2 focus-within:ring-emerald-500/20 focus-within:border-emerald-500 transition-all">
          <Calendar className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="bg-transparent border-none text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-0 text-sm font-semibold cursor-pointer"
          />
        </div>

        {/* Building Filter */}
        <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3.5 py-2 text-sm text-slate-700 dark:text-slate-300 focus-within:ring-2 focus-within:ring-emerald-500/20 focus-within:border-emerald-500 transition-all">
          <Building2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          <select
            value={selectedBuilding}
            onChange={(e) => setSelectedBuilding(e.target.value)}
            className="bg-transparent border-none text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-0 text-sm font-semibold cursor-pointer"
          >
            <option value="All" className="bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200">All Buildings</option>
            {buildings.map((b) => (
              <option key={b} value={b} className="bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200">
                {b}
              </option>
            ))}
          </select>
        </div>

        {/* Theme Toggle Button */}
        <button
          onClick={toggleDarkMode}
          className="p-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-900 text-slate-600 dark:text-slate-300 transition-all cursor-pointer"
          title="Toggle Light/Dark Theme"
        >
          {darkMode ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-indigo-600" />}
        </button>
      </div>

      {/* User Stats & Logout */}
      {user && (
        <div className="flex items-center gap-4">
          <div className="hidden lg:flex flex-col items-end text-right">
            <span className="text-sm font-bold text-slate-800 dark:text-slate-200 leading-none">
              {user.email.split('@')[0]}
              {isAdmin && (
                <span className="ml-2 px-1.5 py-0.5 rounded-md text-[10px] font-extrabold uppercase bg-indigo-100 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300">
                  Admin
                </span>
              )}
            </span>
            <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono mt-1">
              {user.email}
            </span>
          </div>
          <div className="p-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl">
            <User className="w-4 h-4 text-slate-600 dark:text-slate-400" />
          </div>
          <button
            onClick={onLogout}
            className="flex items-center gap-2 px-3 py-2 bg-red-50 dark:bg-red-950/20 hover:bg-red-100 dark:hover:bg-red-900/30 border border-red-200 dark:border-red-900/30 text-red-600 dark:text-red-400 text-sm font-bold rounded-xl transition-all duration-200 cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden sm:inline">Logout</span>
          </button>
        </div>
      )}
    </nav>
  )
}
