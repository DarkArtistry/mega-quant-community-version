// StrategyRunner - Sandboxed strategy execution engine
// Uses Node.js vm module to run user-written strategy code safely

import vm from 'node:vm'
import { createDeltaTrade } from '../trading/DeltaTrade.js'
import { getDatabase } from '../../db/index.js'
import type { DeltaTrade } from '../trading/DeltaTrade.js'

// ============================================================
// Types
// ============================================================

export type RunnerState =
  | 'idle'
  | 'initializing'
  | 'running'
  | 'paused'
  | 'stopping'
  | 'stopped'
  | 'error'

export interface LogEntry {
  level: 'log' | 'warn' | 'error' | 'info'
  message: string
  timestamp: string
}

export interface RunnerStatus {
  strategyId: string
  state: RunnerState
  startedAt: string | null
  stoppedAt: string | null
  error: string | null
  logsCount: number
}

export interface RunnerOptions {
  /** Maximum number of log entries to retain in the buffer */
  maxLogEntries?: number
}

const DEFAULT_MAX_LOG_ENTRIES = 2000

// ============================================================
// StrategyRunner
// ============================================================

export class StrategyRunner {
  public readonly strategyId: string
  public readonly runId: string

  private state: RunnerState = 'idle'
  private logs: LogEntry[] = []
  private startedAt: string | null = null
  private stoppedAt: string | null = null
  private errorMessage: string | null = null
  private deltaTrade: DeltaTrade | null = null
  private executionPromise: Promise<void> | null = null
  private abortController: AbortController | null = null
  private pauseResolve: (() => void) | null = null
  private isPaused = false

  private initStartedAt: number = 0 // timestamp when init started, for stuck detection
  private readonly maxLogEntries: number
  private logInsertStmt: any = null
  private logInsertMany: any = null

  // Batched log writes
  private logBuffer: Array<{ level: string; message: string; timestamp: string }> = []
  private logFlushTimer: ReturnType<typeof setTimeout> | null = null
  private static readonly LOG_BATCH_SIZE = 50
  private static readonly LOG_FLUSH_INTERVAL_MS = 500

  // Track sandbox timers for cleanup
  private sandboxTimers: Set<ReturnType<typeof setTimeout>> = new Set()
  private sandboxIntervals: Set<ReturnType<typeof setInterval>> = new Set()

  constructor(strategyId: string, options?: RunnerOptions) {
    this.strategyId = strategyId
    this.runId = `run-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
    this.maxLogEntries = options?.maxLogEntries ?? DEFAULT_MAX_LOG_ENTRIES

    // Prepare log insert statement for persistent storage
    try {
      const db = getDatabase()
      this.logInsertStmt = db.prepare(
        'INSERT INTO strategy_logs (strategy_id, run_id, level, message, timestamp) VALUES (?, ?, ?, ?, ?)'
      )
      this.logInsertMany = db.transaction((entries: Array<{ level: string; message: string; timestamp: string }>) => {
        for (const entry of entries) {
          this.logInsertStmt.run(this.strategyId, this.runId, entry.level, entry.message, entry.timestamp)
        }
      })
    } catch {
      // Table may not exist yet, will fall back to in-memory only
    }
  }

  // ----------------------------------------------------------
  // Public API
  // ----------------------------------------------------------

  /**
   * Start executing the strategy.
   * Loads strategy code from the database, creates a DeltaTrade instance,
   * and runs the code inside a vm sandbox.
   *
   * Returns immediately — initialization and execution happen in background.
   */
  async start(): Promise<void> {
    if (this.state === 'running' || this.state === 'initializing') {
      throw new Error(`Strategy ${this.strategyId} is already ${this.state}`)
    }

    // Reset state for a fresh run
    this.state = 'initializing'
    this.initStartedAt = Date.now()
    this.logs = []
    this.errorMessage = null
    this.stoppedAt = null
    this.startedAt = new Date().toISOString()
    this.isPaused = false
    this.pauseResolve = null
    this.abortController = new AbortController()

    this.pushLog('info', `Initializing strategy runner for ${this.strategyId}`)

    // Validate code synchronously before going async
    let code: string
    let executionType: string
    try {
      code = this.loadStrategyCode()
      this.pushLog('info', 'Strategy code loaded from database')
      executionType = this.loadExecutionType()
    } catch (err: any) {
      this.state = 'error'
      this.errorMessage = err.message
      this.stoppedAt = new Date().toISOString()
      this.pushLog('error', `Failed to initialize: ${err.message}`)
      throw err
    }

    // Run initialization + execution in background so start() returns immediately.
    // The frontend polls /status to track progress.
    this.executionPromise = this.initAndExecute(code, executionType)
  }

  /**
   * Background init + execution. Sets state to 'running' once DeltaTrade is ready,
   * then runs the user's strategy code.
   */
  private async initAndExecute(code: string, executionType: string): Promise<void> {
    try {
      // Create DeltaTrade (optional — scripts can run without accounts)
      try {
        this.pushLog('info', 'Creating DeltaTrade instance...')
        this.deltaTrade = await createDeltaTrade(executionType, this.strategyId)
        this.pushLog('info', `DeltaTrade ready (execution: ${this.deltaTrade.executionId})`)
      } catch (dtErr: any) {
        this.pushLog('warn', `DeltaTrade not available: ${dtErr.message}`)
        this.pushLog('info', 'Running strategy without trading context (dt will be null)')
        this.deltaTrade = null
      }

      // If stop was requested during initialization, bail out
      if (this.abortController?.signal.aborted || this.state === 'stopping' || this.state === 'stopped') {
        if (this.state !== 'stopped') {
          this.state = 'stopped'
          this.stoppedAt = new Date().toISOString()
        }
        this.pushLog('info', 'Strategy stopped during initialization')
        return
      }

      // Transition to running
      this.state = 'running'
      this.pushLog('info', 'Strategy execution started')

      // Execute the user's strategy code
      await this.executeStrategy(code)

      if (this.state === 'running' || this.state === 'paused') {
        this.state = 'stopped'
        this.stoppedAt = new Date().toISOString()
        this.pushLog('info', 'Strategy execution completed successfully')
      }
    } catch (err: any) {
      if (this.state !== 'stopping' && this.state !== 'stopped') {
        this.state = 'error'
        this.errorMessage = err.message
        this.stoppedAt = new Date().toISOString()
        this.pushLog('error', `Strategy execution failed: ${err.message}`)
        if (err.stack) {
          this.pushLog('error', err.stack)
        }
      }
    } finally {
      // Flush any remaining buffered logs before shutdown
      this.flushLogBuffer()
      // Update DB FIRST so frontend polling picks up the correct status immediately,
      // even if closeDeltaTrade hangs on slow RPCs.
      this.updateStrategyStatusInDb()
      await this.closeDeltaTrade()
    }
  }

  /**
   * Stop the currently running strategy.
   * Aborts the execution and closes the DeltaTrade instance.
   */
  async stop(): Promise<void> {
    // If already stopped/idle/error, just return success (idempotent)
    if (this.state === 'stopped' || this.state === 'idle' || this.state === 'error') {
      return
    }
    if (this.state === 'stopping') {
      // Already stopping, wait for it
      if (this.executionPromise) {
        await Promise.race([
          this.executionPromise,
          new Promise<void>((resolve) => setTimeout(resolve, 5000))
        ]).catch(() => {})
      }
      return
    }

    this.state = 'stopping'
    this.pushLog('info', 'Stopping strategy execution...')
    this.flushLogBuffer()

    // If paused, resume so the execution can terminate
    if (this.isPaused && this.pauseResolve) {
      this.isPaused = false
      this.pauseResolve()
      this.pauseResolve = null
    }

    // Clear all tracked sandbox timers
    for (const handle of this.sandboxTimers) {
      globalThis.clearTimeout(handle)
    }
    this.sandboxTimers.clear()
    for (const handle of this.sandboxIntervals) {
      globalThis.clearInterval(handle)
    }
    this.sandboxIntervals.clear()

    // Signal abort to the execution
    if (this.abortController) {
      this.abortController.abort()
    }

    // Wait for execution to finish (with a grace period)
    if (this.executionPromise) {
      try {
        await Promise.race([
          this.executionPromise,
          new Promise<void>((resolve) => setTimeout(resolve, 10_000))
        ])
      } catch {
        // Execution error during stop is expected
      }
    }

    this.state = 'stopped'
    this.stoppedAt = new Date().toISOString()
    this.pushLog('info', 'Strategy execution stopped')
  }

  /**
   * Pause the running strategy.
   * The execution will block at the next await point until resumed.
   */
  pause(): void {
    if (this.state !== 'running') {
      throw new Error(`Cannot pause strategy ${this.strategyId}: current state is '${this.state}'`)
    }

    this.state = 'paused'
    this.isPaused = true
    this.pushLog('info', 'Strategy execution paused')
  }

  /**
   * Resume a paused strategy.
   */
  resume(): void {
    if (this.state !== 'paused') {
      throw new Error(`Cannot resume strategy ${this.strategyId}: current state is '${this.state}'`)
    }

    this.isPaused = false
    this.state = 'running'
    this.pushLog('info', 'Strategy execution resumed')

    if (this.pauseResolve) {
      this.pauseResolve()
      this.pauseResolve = null
    }
  }

  /**
   * Get the current runner status.
   */
  getStatus(): RunnerStatus {
    return {
      strategyId: this.strategyId,
      state: this.state,
      startedAt: this.startedAt,
      stoppedAt: this.stoppedAt,
      error: this.errorMessage,
      logsCount: this.logs.length
    }
  }

  /**
   * Get buffered log entries.
   * @param since  Optional ISO timestamp; only logs after this time are returned.
   * @param limit  Maximum number of entries to return (newest first). Default: 200.
   */
  getLogs(since?: string, limit = 200): LogEntry[] {
    let entries = this.logs
    if (since) {
      entries = entries.filter((e) => e.timestamp > since)
    }
    // Return the most recent entries
    return entries.slice(-limit)
  }

  // ----------------------------------------------------------
  // Private helpers
  // ----------------------------------------------------------

  /**
   * Load strategy code from the database.
   */
  private loadStrategyCode(): string {
    const db = getDatabase()
    const row = db.prepare('SELECT code FROM strategies WHERE id = ?').get(this.strategyId) as
      | { code: string }
      | undefined

    if (!row) {
      throw new Error(`Strategy not found: ${this.strategyId}`)
    }

    if (!row.code || row.code.trim().length === 0) {
      throw new Error(
        `Strategy has no code. Please write your strategy code and click Run again.`
      )
    }

    return row.code
  }

  /**
   * Load execution type from the database.
   */
  private loadExecutionType(): string {
    const db = getDatabase()
    const row = db
      .prepare('SELECT execution_type FROM strategies WHERE id = ?')
      .get(this.strategyId) as { execution_type: string } | undefined

    return row?.execution_type || 'default'
  }

  /**
   * Execute strategy code in a sandboxed vm context with timeout.
   */
  private async executeStrategy(code: string): Promise<void> {
    const dt = this.deltaTrade // may be null if no accounts configured
    const abortSignal = this.abortController!.signal

    // Build a sandboxed console that captures logs
    const sandboxConsole = {
      log: (...args: any[]) => this.pushLog('log', args.map(formatArg).join(' ')),
      warn: (...args: any[]) => this.pushLog('warn', args.map(formatArg).join(' ')),
      error: (...args: any[]) => this.pushLog('error', args.map(formatArg).join(' ')),
      info: (...args: any[]) => this.pushLog('info', args.map(formatArg).join(' '))
    }

    // Pause-aware sleep utility exposed to strategies
    const sleep = (ms: number): Promise<void> => {
      return new Promise((resolve, reject) => {
        if (abortSignal.aborted) {
          return reject(new Error('Strategy execution aborted'))
        }
        const timer = setTimeout(resolve, ms)
        const onAbort = () => {
          clearTimeout(timer)
          reject(new Error('Strategy execution aborted'))
        }
        abortSignal.addEventListener('abort', onAbort, { once: true })
      })
    }

    // Check-pause helper: if the runner is paused, wait until resumed or aborted
    const checkPause = (): Promise<void> => {
      if (abortSignal.aborted) {
        return Promise.reject(new Error('Strategy execution aborted'))
      }
      if (!this.isPaused) {
        return Promise.resolve()
      }
      return new Promise<void>((resolve, reject) => {
        this.pauseResolve = resolve
        const onAbort = () => reject(new Error('Strategy execution aborted'))
        abortSignal.addEventListener('abort', onAbort, { once: true })
      })
    }

    // Tracked timer wrappers to prevent leaks
    const trackedSetTimeout = (fn: (...args: any[]) => void, ms?: number, ...args: any[]) => {
      const handle = globalThis.setTimeout((...a: any[]) => {
        this.sandboxTimers.delete(handle)
        fn(...a)
      }, ms, ...args)
      this.sandboxTimers.add(handle)
      return handle
    }
    const trackedClearTimeout = (handle: ReturnType<typeof setTimeout>) => {
      this.sandboxTimers.delete(handle)
      globalThis.clearTimeout(handle)
    }
    const trackedSetInterval = (fn: (...args: any[]) => void, ms?: number, ...args: any[]) => {
      const handle = globalThis.setInterval(fn, ms, ...args)
      this.sandboxIntervals.add(handle)
      return handle
    }
    const trackedClearInterval = (handle: ReturnType<typeof setInterval>) => {
      this.sandboxIntervals.delete(handle)
      globalThis.clearInterval(handle)
    }

    // Build the sandbox context
    const sandbox = {
      console: sandboxConsole,
      dt,
      sleep,
      checkPause,
      setTimeout: trackedSetTimeout,
      clearTimeout: trackedClearTimeout,
      setInterval: trackedSetInterval,
      clearInterval: trackedClearInterval,
      Promise: globalThis.Promise,
      Date: globalThis.Date,
      Math: globalThis.Math,
      JSON: globalThis.JSON,
      Number: globalThis.Number,
      String: globalThis.String,
      Boolean: globalThis.Boolean,
      Array: globalThis.Array,
      Object: globalThis.Object,
      Map: globalThis.Map,
      Set: globalThis.Set,
      Error: globalThis.Error,
      BigInt: globalThis.BigInt,
      parseFloat: globalThis.parseFloat,
      parseInt: globalThis.parseInt,
      isNaN: globalThis.isNaN,
      isFinite: globalThis.isFinite,
      undefined: undefined
    }

    const context = vm.createContext(sandbox)

    // Wrap the user code so that the execute(dt) function is defined and called.
    // The user's code is expected to contain: async function execute(dt) { ... }
    const wrappedCode = `
      (async () => {
        ${code}

        if (typeof execute !== 'function') {
          throw new Error('Strategy code must define an async function execute(dt) { ... }')
        }

        await execute(dt);
      })()
    `

    try {
      const script = new vm.Script(wrappedCode, {
        filename: `strategy-${this.strategyId}.js`
      })

      // Run the script — no timeout so strategies can run indefinitely.
      // Stopping is handled via AbortController (sleep/checkPause reject on abort).
      const resultPromise = script.runInContext(context, {
        breakOnSigint: true
      }) as Promise<void>

      // The script returns a promise (async IIFE), so we await it
      await resultPromise
    } catch (err: any) {
      // Distinguish between abort and other errors
      if (abortSignal.aborted) {
        this.pushLog('info', 'Execution aborted by stop request')
        return
      }

      throw err
    }
  }

  /**
   * Close the DeltaTrade instance if it exists.
   */
  private async closeDeltaTrade(): Promise<void> {
    if (this.deltaTrade) {
      try {
        // Timeout close() so slow RPCs don't hang cleanup forever
        await Promise.race([
          this.deltaTrade.close(),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('DeltaTrade close timed out')), 15_000))
        ])
        this.pushLog('info', 'DeltaTrade instance closed')
      } catch (err: any) {
        this.pushLog('warn', `Error closing DeltaTrade: ${err.message}`)
      }
      this.deltaTrade = null
    }
  }

  /**
   * Persist the runner's final state back to the strategies table and broadcast via WS.
   */
  private updateStrategyStatusInDb(): void {
    try {
      const db = getDatabase()
      const dbStatus = this.state === 'error' ? 'error' : 'stopped'
      db.prepare('UPDATE strategies SET status = ?, stopped_at = datetime(\'now\'), updated_at = datetime(\'now\') WHERE id = ?')
        .run(dbStatus, this.strategyId)

      // Broadcast to WebSocket clients so frontend updates immediately
      import('../../services/live-data.js').then(({ liveDataService }) => {
        liveDataService.broadcastStrategyUpdate({
          strategyId: this.strategyId,
          status: dbStatus,
          message: dbStatus === 'error' ? `Error: ${this.errorMessage}` : 'Strategy completed',
          timestamp: Date.now()
        })
      }).catch(() => {})
    } catch {
      // Non-critical — frontend polling will catch up
    }
  }

  /**
   * Push a log entry to the buffer. DB writes are batched for performance.
   */
  private pushLog(level: LogEntry['level'], message: string): void {
    const timestamp = new Date().toISOString()
    const entry: LogEntry = { level, message, timestamp }
    this.logs.push(entry)

    // Trim in-memory buffer if over max
    if (this.logs.length > this.maxLogEntries) {
      this.logs = this.logs.slice(-this.maxLogEntries)
    }

    // Buffer for batched DB write
    this.logBuffer.push({ level, message, timestamp })

    if (this.logBuffer.length >= StrategyRunner.LOG_BATCH_SIZE) {
      this.flushLogBuffer()
    } else if (!this.logFlushTimer) {
      this.logFlushTimer = setTimeout(() => this.flushLogBuffer(), StrategyRunner.LOG_FLUSH_INTERVAL_MS)
    }
  }

  /**
   * Flush buffered log entries to the database in a single transaction.
   */
  private flushLogBuffer(): void {
    if (this.logFlushTimer) {
      clearTimeout(this.logFlushTimer)
      this.logFlushTimer = null
    }

    if (this.logBuffer.length === 0) return

    const entries = this.logBuffer.splice(0)
    try {
      if (this.logInsertMany) {
        this.logInsertMany(entries)
      } else if (this.logInsertStmt) {
        for (const e of entries) {
          this.logInsertStmt.run(this.strategyId, this.runId, e.level, e.message, e.timestamp)
        }
      }
    } catch {
      // Ignore DB errors in hot path
    }
  }
}

// ============================================================
// StrategyRunnerManager - Singleton managing all runners
// ============================================================

class StrategyRunnerManager {
  private runners: Map<string, StrategyRunner> = new Map()

  /**
   * Get or create a runner for a strategy.
   * If a runner already exists and is in a terminal state (stopped/error/idle),
   * a new runner replaces it.
   */
  getOrCreateRunner(strategyId: string, options?: RunnerOptions): StrategyRunner {
    const existing = this.runners.get(strategyId)
    if (existing) {
      const status = existing.getStatus()
      const state = status.state
      // Allow replacing runners stuck in 'initializing' for >60s
      const isStuckInit = state === 'initializing' && existing['initStartedAt'] > 0
        && (Date.now() - existing['initStartedAt']) > 60_000
      if (!isStuckInit && (state === 'running' || state === 'paused' || state === 'initializing' || state === 'stopping')) {
        return existing
      }
      if (isStuckInit) {
        console.warn(`[StrategyRunnerManager] Replacing stuck initializing runner for ${strategyId}`)
      }
    }

    const runner = new StrategyRunner(strategyId, options)
    this.runners.set(strategyId, runner)
    return runner
  }

  /**
   * Get the runner for a strategy if one exists.
   */
  getRunner(strategyId: string): StrategyRunner | undefined {
    return this.runners.get(strategyId)
  }

  /**
   * Remove a runner from the manager.
   * Only removes if the runner is in a terminal state.
   */
  removeRunner(strategyId: string): boolean {
    const runner = this.runners.get(strategyId)
    if (!runner) return false

    const state = runner.getStatus().state
    if (state === 'running' || state === 'paused' || state === 'initializing' || state === 'stopping') {
      return false // Cannot remove an active runner
    }

    this.runners.delete(strategyId)
    return true
  }

  /**
   * Get all active runner statuses.
   */
  getActiveRunners(): RunnerStatus[] {
    const active: RunnerStatus[] = []
    for (const runner of this.runners.values()) {
      const status = runner.getStatus()
      if (status.state === 'running' || status.state === 'paused' || status.state === 'initializing') {
        active.push(status)
      }
    }
    return active
  }

  /**
   * Get all runner statuses (including stopped/error).
   */
  getAllRunners(): RunnerStatus[] {
    return Array.from(this.runners.values()).map((r) => r.getStatus())
  }

  /**
   * Stop all active runners. Used during graceful shutdown.
   */
  async stopAll(): Promise<void> {
    const stopPromises: Promise<void>[] = []
    for (const runner of this.runners.values()) {
      const state = runner.getStatus().state
      if (state === 'running' || state === 'paused') {
        stopPromises.push(
          runner.stop().catch((err) => {
            console.error(`[StrategyRunnerManager] Error stopping ${runner.strategyId}:`, err.message)
          })
        )
      }
    }
    await Promise.all(stopPromises)
  }
}

// ============================================================
// Singleton export
// ============================================================

export const strategyRunnerManager = new StrategyRunnerManager()

// ============================================================
// Utility
// ============================================================

function formatArg(arg: any): string {
  if (arg === undefined) return 'undefined'
  if (arg === null) return 'null'
  if (typeof arg === 'string') return arg
  if (typeof arg === 'number' || typeof arg === 'boolean' || typeof arg === 'bigint') {
    return String(arg)
  }
  if (arg instanceof Error) {
    return arg.stack || arg.message
  }
  try {
    return JSON.stringify(arg, null, 2)
  } catch {
    return String(arg)
  }
}
