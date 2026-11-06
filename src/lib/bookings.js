import { supabase } from '../supabaseClient'

// Soft-cancels a booking (status = 'cancelled'; the row is never deleted).
// RLS decides who may cancel: the owner, or an admin (see migration_02/03).
// RLS silently skips rows the user may not change, so we ask for the updated
// row back and treat "0 rows" as a failure. Throws an Error on failure.
export async function cancelBooking(bookingId) {
  const { data, error } = await supabase
    .from('bookings')
    .update({ status: 'cancelled' })
    .eq('id', bookingId)
    .eq('status', 'confirmed')
    .select('id')

  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error(
      'This booking could not be cancelled. It may already be cancelled or belong to someone else.'
    )
  }
}

// True if a booking has not finished yet, using campus date/time strings.
export const isUpcoming = (booking, todayStr, nowTimeStr) =>
  booking.date > todayStr || (booking.date === todayStr && booking.end_time > nowTimeStr)
