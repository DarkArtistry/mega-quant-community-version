import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { createServer } from 'http'
import { initDatabase, closeDatabase } from './db/index.js'
import { liveDataService } from './services/live-data.js'

// Import routes
import securityRouter from './routes/security.js'
import hdWalletsRouter from './routes/hd-wallets.js'
import strategiesRouter from './routes/strategies.js'
import strategyAccountsRouter from './routes/strategy-accounts.js'
import executionsRouter from './routes/executions.js'
import tradesRouter from './routes/trades.js'
import tradingRouter from './routes/trading.js'
import portfolioRouter from './routes/portfolio.js'
import configEncryptedRouter from './routes/config-encrypted.js'
import pnlRouter from './routes/pnl.js'
import ordersRouter from './routes/orders.js'
import pricesRouter from './routes/prices.js'
import strategyRunnerRouter from './routes/strategy-runner.js'
import accountActivityRouter from './routes/account-activity.js'
import healthCheckRouter from './routes/health-check.js'
import walletsRouter from './routes/wallets.js'
import perpsRouter from './routes/perps.js'
import optionsRouter from './routes/options.js'
import lendingRouter from './routes/lending.js'
import liquidityRouter from './routes/liquidity.js'
import { strategyRunnerManager } from './lib/strategy/StrategyRunner.js'
import { pnlSnapshotter } from './lib/trading/pnl/PnlSnapshotter.js'
import { orderReconciler } from './services/order-reconciler.js'
import { fundingTracker } from './lib/trading/services/FundingTracker.js'
import { optionsExpiryChecker } from './lib/trading/services/OptionsExpiryChecker.js'
import { aaveInterestTracker } from './lib/trading/services/AaveInterestTracker.js'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3001

// Middleware
app.use(cors({
  origin: true, // Allow all origins in development
  credentials: true
}))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// Request logging middleware (skip HEAD requests from wait-on polling)
app.use((req, res, next) => {
  if (req.method !== 'HEAD') {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`)
  }
  next()
})

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  })
})

// API routes
app.use('/api/security', securityRouter)
app.use('/api/hd-wallets', hdWalletsRouter)
app.use('/api/strategies', strategiesRouter)
app.use('/api/strategy-accounts', strategyAccountsRouter)
app.use('/api/executions', executionsRouter)
app.use('/api/trades', tradesRouter)
app.use('/api/trading', tradingRouter)
app.use('/api/portfolio', portfolioRouter)
app.use('/api/config-encrypted', configEncryptedRouter)
app.use('/api/pnl', pnlRouter)
app.use('/api/orders', ordersRouter)
app.use('/api/prices', pricesRouter)
app.use('/api/strategy-runner', strategyRunnerRouter)
app.use('/api/account-activity', accountActivityRouter)
app.use('/api/health', healthCheckRouter)
app.use('/api/wallets', walletsRouter)
app.use('/api/perps', perpsRouter)
app.use('/api/options', optionsRouter)
app.use('/api/lending', lendingRouter)
app.use('/api/liquidity', liquidityRouter)

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err)
  res.status(err.status || 500).json({
    error: {
      message: err.message || 'Internal server error',
      status: err.status || 500
    }
  })
})

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: {
      message: 'Not found',
      status: 404
    }
  })
})

// Create HTTP server
const httpServer = createServer(app)

// Start server
async function startServer() {
  try {
    // Initialize SQLite database (auto-creates if doesn't exist)
    console.log('Initializing database...')
    initDatabase()
    console.log('Database ready!')

    // Start listening
    httpServer.listen(PORT, () => {
      console.log(`\n${'='.repeat(60)}`)
      console.log('MEGA QUANT Backend API Server')
      console.log(`${'='.repeat(60)}`)
      console.log(`HTTP Server: http://localhost:${PORT}`)
      console.log(`Database: SQLite (zero-config)`)
      console.log(`Environment: ${process.env.NODE_ENV || 'development'}`)
      console.log(`${'='.repeat(60)}\n`)

      // Initialize WebSocket live-data service
      liveDataService.initialize(httpServer)
      console.log(`WebSocket: ws://localhost:${PORT}/ws/live-data`)

      // Start PnL snapshotter (hourly snapshots)
      pnlSnapshotter.start()
      console.log(`[PnlSnapshotter] Started with 1-hour interval`)

      // Start order reconciler (checks pending orders every 30s)
      orderReconciler.start()
      console.log(`[OrderReconciler] Started with 30-second interval`)

      // Start multi-instrument background services
      fundingTracker.start()
      console.log(`[FundingTracker] Started with 1-hour interval`)

      optionsExpiryChecker.start()
      console.log(`[OptionsExpiryChecker] Started with 1-hour interval`)

      aaveInterestTracker.start()
      console.log(`[AaveInterestTracker] Started with 5-minute interval`)
    })
  } catch (error) {
    console.error('Failed to start server:', error)
    process.exit(1)
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n\nShutting down gracefully...')
  await strategyRunnerManager.stopAll()
  pnlSnapshotter.stop()
  orderReconciler.stop()
  fundingTracker.stop()
  optionsExpiryChecker.stop()
  aaveInterestTracker.stop()
  liveDataService.shutdown()
  closeDatabase()
  process.exit(0)
})

process.on('SIGTERM', async () => {
  console.log('\n\nShutting down gracefully...')
  await strategyRunnerManager.stopAll()
  pnlSnapshotter.stop()
  orderReconciler.stop()
  fundingTracker.stop()
  optionsExpiryChecker.stop()
  aaveInterestTracker.stop()
  liveDataService.shutdown()
  closeDatabase()
  process.exit(0)
})

// Start the server
startServer()

export default app
