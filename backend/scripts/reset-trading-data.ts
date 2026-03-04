/**
 * Reset trading data script.
 *
 * Clears all trading-related tables while preserving:
 *   - strategies (code, config)
 *   - accounts, hd_wallets
 *   - api_configs
 *   - strategy_account_mappings
 *   - app_security
 *
 * Usage:
 *   npx tsx backend/scripts/reset-trading-data.ts
 */

import { initDatabase, closeDatabase } from '../src/db/sqlite.js'

const db = initDatabase()

const tables = [
  'pnl_snapshots',
  'trade_fills',
  'trades',
  'orders',
  'positions',
  'perp_positions',
  'options_positions',
  'lending_positions',
  'funding_payments',
  'portfolio_snapshots',
  'strategy_executions',
  'account_activity_log',
  'strategy_logs',
]

console.log('Resetting trading data...\n')

for (const table of tables) {
  try {
    const result = db.prepare(`DELETE FROM ${table}`).run()
    console.log(`  ${table}: ${result.changes} rows deleted`)
  } catch (e: any) {
    // Table may not exist in older schemas
    console.log(`  ${table}: skipped (${e.message})`)
  }
}

// Reset strategy statuses to 'stopped'
try {
  const result = db.prepare(`UPDATE strategies SET status = 'stopped', started_at = NULL`).run()
  console.log(`\n  strategies: ${result.changes} reset to 'stopped'`)
} catch (e: any) {
  console.log(`  strategies: skip status reset (${e.message})`)
}

console.log('\nDone. Trading data cleared, strategies/accounts/keys preserved.')

closeDatabase()
