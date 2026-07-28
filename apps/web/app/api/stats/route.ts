import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export async function GET() {
  try {
    const [vendorResult, cityResult] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM vendors WHERE is_active = true AND deleted_at IS NULL'),
      pool.query('SELECT COUNT(DISTINCT city_id) FROM vendors WHERE is_active = true AND city_id IS NOT NULL AND deleted_at IS NULL'),
    ])

    return NextResponse.json({
      activeVendors: parseInt(vendorResult.rows[0].count),
      activeCities: parseInt(cityResult.rows[0].count),
    })
  } catch {
    return NextResponse.json({ activeVendors: 0, activeCities: 0 })
  }
}
