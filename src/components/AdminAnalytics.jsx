import { useState } from 'react'
import { BarChart3, Table2 } from 'lucide-react'
import { addDays, getTodayStr } from '../lib/time'

// Admin usage analytics, computed client-side from the bookings AdminPanel
// already loads (no extra DB view needed). Plain SVG, no chart library.
//
// - "Bookings per room": confirmed bookings in the last 30 days, per room.
// - "Peak booking hours": for each hour 08:00-21:00, how many confirmed
//   bookings in the last 30 days were active during that hour.
//
// Single series per chart -> one hue (emerald-600, validated for contrast on
// both light and dark surfaces), no legend; the title names the series.

const FIRST_HOUR = 8
const LAST_HOUR = 21 // last bar is 21:00-22:00
const BAR_FILL = 'fill-emerald-600'
const pad = (h) => String(h).padStart(2, '0')

function computeStats(bookings, rooms) {
  const today = getTodayStr()
  const since = addDays(today, -30)
  const recent = bookings.filter((b) => b.status === 'confirmed' && b.date >= since && b.date <= today)

  const perRoomMap = new Map(rooms.map((r) => [r.id, { label: r.name, value: 0 }]))
  for (const b of recent) {
    const entry = perRoomMap.get(b.room_id)
    if (entry) entry.value += 1
  }
  const perRoom = [...perRoomMap.values()]
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))

  const perHour = []
  for (let h = FIRST_HOUR; h <= LAST_HOUR; h++) {
    const slotStart = `${pad(h)}:00:00`
    const slotEnd = `${pad(h + 1)}:00:00`
    const value = recent.filter((b) => b.start_time < slotEnd && b.end_time > slotStart).length
    perHour.push({ label: `${pad(h)}:00`, range: `${pad(h)}:00-${pad(h + 1)}:00`, value })
  }

  return { total: recent.length, perRoom, perHour }
}

// Small hover tooltip shown above the chart.
const Tooltip = ({ item }) => (
  <div className="h-6 text-xs text-slate-600 dark:text-slate-300">
    {item ? (
      <span>
        <strong className="text-slate-900 dark:text-white">{item.range || item.label}</strong>: {item.value} booking{item.value === 1 ? '' : 's'}
      </span>
    ) : (
      <span className="text-slate-400 dark:text-slate-500">Hover a bar for details</span>
    )}
  </div>
)

// Horizontal bars: one row per room, value at the bar end.
function RoomBars({ data }) {
  const [hover, setHover] = useState(null)
  const rowH = 26
  const labelW = 130
  const chartW = 600
  const barMaxW = chartW - labelW - 40
  const max = Math.max(1, ...data.map((d) => d.value))
  const height = data.length * rowH

  return (
    <div>
      <Tooltip item={hover} />
      <svg viewBox={`0 0 ${chartW} ${height}`} className="w-full" role="img" aria-label="Bookings per room, last 30 days">
        {data.map((d, i) => {
          const y = i * rowH
          const w = Math.max(2, (d.value / max) * barMaxW)
          return (
            <g key={d.label} onMouseEnter={() => setHover(d)} onMouseLeave={() => setHover(null)}>
              {/* Full-row hit target, bigger than the bar */}
              <rect x="0" y={y} width={chartW} height={rowH} className="fill-transparent" />
              <text x={labelW - 8} y={y + rowH / 2} dominantBaseline="middle" textAnchor="end"
                className="fill-slate-600 dark:fill-slate-300 text-[12px]">
                {d.label}
              </text>
              <rect x={labelW} y={y + 5} width={w} height={rowH - 10} rx="4"
                className={`${BAR_FILL} ${hover && hover.label !== d.label ? 'opacity-50' : ''} transition-opacity`} />
              <text x={labelW + w + 6} y={y + rowH / 2} dominantBaseline="middle"
                className="fill-slate-500 dark:fill-slate-400 text-[11px] font-bold">
                {d.value}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// Vertical bars: one per hour of the day, with a light y-grid.
function HourBars({ data }) {
  const [hover, setHover] = useState(null)
  const chartW = 600
  const chartH = 200
  const left = 28
  const bottom = 22
  const plotW = chartW - left
  const plotH = chartH - bottom - 6
  const max = Math.max(1, ...data.map((d) => d.value))
  const ticks = [0, Math.ceil(max / 2), max].filter((v, i, a) => a.indexOf(v) === i)
  const slot = plotW / data.length
  const barW = slot - 2 // 2px surface gap between bars
  const yFor = (v) => 6 + plotH - (v / max) * plotH

  return (
    <div>
      <Tooltip item={hover} />
      <svg viewBox={`0 0 ${chartW} ${chartH}`} className="w-full" role="img" aria-label="Bookings active per hour, last 30 days">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={left} x2={chartW} y1={yFor(t)} y2={yFor(t)} className="stroke-slate-200 dark:stroke-slate-800" strokeWidth="1" />
            <text x={left - 6} y={yFor(t)} dominantBaseline="middle" textAnchor="end"
              className="fill-slate-400 dark:fill-slate-500 text-[10px]">{t}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = left + i * slot + 1
          const y = yFor(d.value)
          const h = 6 + plotH - y
          return (
            <g key={d.label} onMouseEnter={() => setHover(d)} onMouseLeave={() => setHover(null)}>
              <rect x={x} y="0" width={barW} height={chartH - bottom} className="fill-transparent" />
              {d.value > 0 && (
                // Rounded top, square base anchored to the baseline.
                <path
                  d={`M${x},${y + h} V${y + Math.min(4, h)} Q${x},${y} ${x + Math.min(4, barW / 2)},${y} H${x + barW - Math.min(4, barW / 2)} Q${x + barW},${y} ${x + barW},${y + Math.min(4, h)} V${y + h} Z`}
                  className={`${BAR_FILL} ${hover && hover.label !== d.label ? 'opacity-50' : ''} transition-opacity`}
                />
              )}
              {i % 2 === 0 && (
                <text x={x + barW / 2} y={chartH - 6} textAnchor="middle"
                  className="fill-slate-400 dark:fill-slate-500 text-[10px]">{d.label}</text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function DataTable({ title, rows, labelKey = 'label' }) {
  return (
    <table className="w-full text-left text-xs border-collapse mt-2">
      <thead>
        <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 dark:text-slate-500 uppercase tracking-wider">
          <th className="py-1.5">{title}</th>
          <th className="py-1.5 text-right">Bookings</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 dark:divide-slate-800/40 text-slate-700 dark:text-slate-300">
        {rows.map((r) => (
          <tr key={r[labelKey]}>
            <td className="py-1.5">{r[labelKey]}</td>
            <td className="py-1.5 text-right font-mono">{r.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default function AdminAnalytics({ bookings, rooms }) {
  const [showTable, setShowTable] = useState(false)
  const { total, perRoom, perHour } = computeStats(bookings, rooms)
  const peak = perHour.reduce((best, h) => (h.value > best.value ? h : best), perHour[0])

  return (
    <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm mb-8">
      <div className="flex flex-wrap justify-between items-center gap-2 mb-6">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
          <h2 className="text-lg font-bold text-slate-900 dark:text-white font-display">Usage Analytics (last 30 days)</h2>
        </div>
        <button
          onClick={() => setShowTable(!showTable)}
          className="px-3 py-1.5 rounded-xl text-xs font-bold inline-flex items-center gap-1 cursor-pointer bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200"
        >
          {showTable ? <BarChart3 className="w-3.5 h-3.5" /> : <Table2 className="w-3.5 h-3.5" />}
          {showTable ? 'Show charts' : 'Show as table'}
        </button>
      </div>

      {total === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">No confirmed bookings in the last 30 days yet.</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div>
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">Bookings per room</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">{total} confirmed booking{total === 1 ? '' : 's'} in total</p>
            {showTable ? <DataTable title="Room" rows={perRoom} /> : <RoomBars data={perRoom} />}
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">Peak booking hours</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
              Busiest hour: <strong className="text-slate-800 dark:text-slate-200">{peak.range}</strong> ({peak.value} booking{peak.value === 1 ? '' : 's'} active)
            </p>
            {showTable ? <DataTable title="Hour" rows={perHour} labelKey="range" /> : <HourBars data={perHour} />}
          </div>
        </div>
      )}
    </section>
  )
}
