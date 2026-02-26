import Database from 'better-sqlite3'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { homedir } from 'os'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

let db: Database.Database | null = null

// Get database path in user's app data directory
function getDatabasePath(): string {
  // Use environment variable if provided (set by Electron main process)
  if (process.env.MEGAQUANT_DATA_DIR) {
    const dbDir = join(process.env.MEGAQUANT_DATA_DIR, 'database')
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true })
    }
    return join(dbDir, 'megaquant.db')
  }

  // Otherwise use user's home directory
  const appDataDir = process.platform === 'win32'
    ? join(homedir(), 'AppData', 'Roaming', 'MEGA QUANT')
    : process.platform === 'darwin'
    ? join(homedir(), 'Library', 'Application Support', 'MEGA QUANT')
    : join(homedir(), '.megaquant')

  const dbDir = join(appDataDir, 'database')

  // Ensure directory exists
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true })
  }

  return join(dbDir, 'megaquant.db')
}

// Initialize database connection
export function initDatabase(): Database.Database {
  if (db) {
    return db
  }

  const dbPath = getDatabasePath()
  console.log(`Database location: ${dbPath}`)

  // Create database connection
  db = new Database(dbPath)

  // Enable foreign keys
  db.pragma('foreign_keys = ON')

  // Initialize schema if needed
  initializeSchema()

  console.log('SQLite database initialized')

  return db
}

// Initialize database schema
function initializeSchema() {
  if (!db) {
    throw new Error('Database not initialized')
  }

  // Check if tables exist
  const tableExists = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type='table' AND name='strategies'
  `).get()

  if (!tableExists) {
    console.log('Creating database schema...')

    // Create all tables
    db.exec(`
      -- 1. strategies table
      CREATE TABLE strategies (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        code TEXT NOT NULL,
        execution_type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'stopped',
        trading_views TEXT DEFAULT '[]',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        started_at DATETIME,
        stopped_at DATETIME
      );

      CREATE INDEX idx_strategies_status ON strategies(status);

      -- 2. wallet_config table
      CREATE TABLE wallet_config (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        strategy_id TEXT NOT NULL,
        wallet_address TEXT NOT NULL,
        chain_id INTEGER NOT NULL,
        is_primary INTEGER DEFAULT 0,
        added_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (strategy_id) REFERENCES strategies(id) ON DELETE CASCADE,
        UNIQUE(strategy_id, wallet_address, chain_id)
      );

      CREATE INDEX idx_wallet_config_strategy ON wallet_config(strategy_id);
      CREATE INDEX idx_wallet_config_address ON wallet_config(wallet_address);

      -- 3. strategy_executions table
      CREATE TABLE strategy_executions (
        id TEXT PRIMARY KEY,
        strategy_id TEXT NOT NULL,
        execution_type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        opened_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        closed_at DATETIME,
        starting_inventory TEXT,
        ending_inventory TEXT,
        initial_inventory_usd REAL DEFAULT 0,
        final_inventory_usd REAL DEFAULT 0,
        realized_pnl_usd REAL DEFAULT 0,
        FOREIGN KEY (strategy_id) REFERENCES strategies(id) ON DELETE CASCADE
      );

      CREATE INDEX idx_executions_strategy ON strategy_executions(strategy_id);
      CREATE INDEX idx_executions_status ON strategy_executions(status);

      -- 4. trades table (with new slippage columns)
      CREATE TABLE trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        execution_id TEXT,
        strategy_id TEXT,
        wallet_address TEXT NOT NULL,
        timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        chain_id INTEGER NOT NULL,
        protocol TEXT,
        tx_hash TEXT NOT NULL UNIQUE,
        block_number INTEGER NOT NULL,

        token_in_address TEXT NOT NULL,
        token_in_symbol TEXT NOT NULL,
        token_in_amount TEXT NOT NULL,

        token_out_address TEXT NOT NULL,
        token_out_symbol TEXT NOT NULL,
        token_out_amount TEXT NOT NULL,

        token_in_price_usd REAL,
        token_out_price_usd REAL,
        value_in_usd REAL,
        value_out_usd REAL,
        profit_loss_usd REAL,

        gas_used INTEGER,
        gas_price_gwei TEXT,
        gas_cost_usd REAL,

        status TEXT DEFAULT 'completed',

        expected_output TEXT,
        actual_output TEXT,
        slippage_amount TEXT,
        slippage_percentage REAL,
        execution_price TEXT,
        quote_price TEXT,
        order_id TEXT
      );

      CREATE INDEX idx_trades_strategy_wallet ON trades(strategy_id, wallet_address);
      CREATE INDEX idx_trades_execution ON trades(execution_id);
      CREATE INDEX idx_trades_timestamp ON trades(timestamp DESC);
      CREATE INDEX idx_trades_chain ON trades(chain_id);
      CREATE INDEX idx_trades_tx_hash ON trades(tx_hash);

      -- 5. assets table
      CREATE TABLE assets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL,
        name TEXT,
        chain_id INTEGER NOT NULL,
        contract_address TEXT,
        decimals INTEGER DEFAULT 18,
        is_native INTEGER DEFAULT 0,
        coingecko_id TEXT,
        added_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(chain_id, contract_address)
      );

      CREATE INDEX idx_assets_chain ON assets(chain_id);
      CREATE INDEX idx_assets_symbol ON assets(symbol);

      -- 6. token_balances table
      CREATE TABLE token_balances (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        wallet_address TEXT NOT NULL,
        chain_id INTEGER NOT NULL,
        asset_id INTEGER NOT NULL,
        balance REAL NOT NULL DEFAULT 0,
        balance_usd REAL,
        last_updated DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE,
        UNIQUE(wallet_address, chain_id, asset_id)
      );

      CREATE INDEX idx_balances_wallet ON token_balances(wallet_address);
      CREATE INDEX idx_balances_chain ON token_balances(chain_id);

      -- 7. gas_reserves table
      CREATE TABLE gas_reserves (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        wallet_address TEXT NOT NULL,
        chain_id INTEGER NOT NULL,
        native_token_balance REAL NOT NULL DEFAULT 0,
        native_token_usd REAL,
        threshold_warning REAL DEFAULT 0.1,
        threshold_critical REAL DEFAULT 0.05,
        last_updated DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(wallet_address, chain_id)
      );

      CREATE INDEX idx_gas_reserves_wallet ON gas_reserves(wallet_address);
      CREATE INDEX idx_gas_reserves_chain ON gas_reserves(chain_id);

      -- 8. perp_positions table
      CREATE TABLE perp_positions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        execution_id TEXT,
        strategy_id TEXT,
        chain_id INTEGER NOT NULL,
        protocol TEXT NOT NULL,
        market_symbol TEXT NOT NULL,
        position_size REAL NOT NULL,
        entry_price REAL NOT NULL,
        leverage REAL NOT NULL,
        liquidation_price REAL,
        unrealized_pnl REAL DEFAULT 0,
        opened_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        closed_at DATETIME,
        FOREIGN KEY (execution_id) REFERENCES strategy_executions(id) ON DELETE CASCADE,
        FOREIGN KEY (strategy_id) REFERENCES strategies(id) ON DELETE SET NULL
      );

      CREATE INDEX idx_perps_execution ON perp_positions(execution_id);
      CREATE INDEX idx_perps_strategy ON perp_positions(strategy_id);

      -- 9. options_positions table
      CREATE TABLE options_positions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        execution_id TEXT,
        strategy_id TEXT,
        chain_id INTEGER NOT NULL,
        protocol TEXT NOT NULL,
        option_type TEXT NOT NULL,
        underlying_asset TEXT NOT NULL,
        strike_price REAL NOT NULL,
        expiry DATETIME NOT NULL,
        premium_paid REAL NOT NULL,
        contracts REAL NOT NULL,
        opened_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        closed_at DATETIME,
        FOREIGN KEY (execution_id) REFERENCES strategy_executions(id) ON DELETE CASCADE,
        FOREIGN KEY (strategy_id) REFERENCES strategies(id) ON DELETE SET NULL
      );

      CREATE INDEX idx_options_execution ON options_positions(execution_id);
      CREATE INDEX idx_options_strategy ON options_positions(strategy_id);

      -- 10. lp_positions table
      CREATE TABLE lp_positions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        execution_id TEXT,
        strategy_id TEXT,
        chain_id INTEGER NOT NULL,
        protocol TEXT NOT NULL,
        pool_address TEXT NOT NULL,
        token0 TEXT NOT NULL,
        token1 TEXT NOT NULL,
        liquidity REAL NOT NULL,
        token0_amount REAL,
        token1_amount REAL,
        fee_tier REAL,
        opened_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        closed_at DATETIME,
        FOREIGN KEY (execution_id) REFERENCES strategy_executions(id) ON DELETE CASCADE,
        FOREIGN KEY (strategy_id) REFERENCES strategies(id) ON DELETE SET NULL
      );

      CREATE INDEX idx_lp_execution ON lp_positions(execution_id);
      CREATE INDEX idx_lp_strategy ON lp_positions(strategy_id);

      -- 11. funding_payments table
      CREATE TABLE funding_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        perp_position_id INTEGER NOT NULL,
        payment_amount REAL NOT NULL,
        funding_rate REAL NOT NULL,
        timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (perp_position_id) REFERENCES perp_positions(id) ON DELETE CASCADE
      );

      CREATE INDEX idx_funding_position ON funding_payments(perp_position_id);
      CREATE INDEX idx_funding_timestamp ON funding_payments(timestamp);

      -- 12. portfolio_snapshots table
      CREATE TABLE portfolio_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        strategy_id TEXT,
        total_value_usd REAL NOT NULL,
        spot_value_usd REAL DEFAULT 0,
        perp_value_usd REAL DEFAULT 0,
        options_value_usd REAL DEFAULT 0,
        lp_value_usd REAL DEFAULT 0,
        cash_usd REAL DEFAULT 0,
        timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (strategy_id) REFERENCES strategies(id) ON DELETE CASCADE
      );

      CREATE INDEX idx_snapshots_strategy ON portfolio_snapshots(strategy_id);
      CREATE INDEX idx_snapshots_timestamp ON portfolio_snapshots(timestamp);

      -- 13. price_history table
      CREATE TABLE price_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        asset_id INTEGER NOT NULL,
        price_usd REAL NOT NULL,
        source TEXT,
        timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
      );

      CREATE INDEX idx_price_asset ON price_history(asset_id);
      CREATE INDEX idx_price_timestamp ON price_history(timestamp);

      -- 14. app_security table (single row for password and encryption)
      CREATE TABLE app_security (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        key_salt TEXT NOT NULL,
        is_setup_complete INTEGER NOT NULL DEFAULT 0,
        setup_at DATETIME,
        last_unlocked_at DATETIME,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      -- 15. api_configs table (single row config) - ENCRYPTED (with Binance fields)
      CREATE TABLE api_configs (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        alchemy_app_id_encrypted TEXT,
        alchemy_app_id_iv TEXT,
        alchemy_app_id_tag TEXT,
        alchemy_api_key_encrypted TEXT,
        alchemy_api_key_iv TEXT,
        alchemy_api_key_tag TEXT,
        etherscan_api_key_encrypted TEXT,
        etherscan_api_key_iv TEXT,
        etherscan_api_key_tag TEXT,
        coinmarketcap_api_key_encrypted TEXT,
        coinmarketcap_api_key_iv TEXT,
        coinmarketcap_api_key_tag TEXT,
        oneinch_api_key_encrypted TEXT,
        oneinch_api_key_iv TEXT,
        oneinch_api_key_tag TEXT,
        binance_api_key_encrypted TEXT,
        binance_api_key_iv TEXT,
        binance_api_key_tag TEXT,
        binance_api_secret_encrypted TEXT,
        binance_api_secret_iv TEXT,
        binance_api_secret_tag TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      -- Insert default empty config
      INSERT INTO api_configs (id) VALUES (1);

      -- 16. hd_wallets table - HD wallet storage with encrypted mnemonics
      CREATE TABLE hd_wallets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        mnemonic_encrypted TEXT NOT NULL,
        mnemonic_iv TEXT NOT NULL,
        mnemonic_tag TEXT NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX idx_hd_wallets_name ON hd_wallets(name);

      -- 17. accounts table - ENCRYPTED (supports both HD and imported accounts)
      CREATE TABLE accounts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        address TEXT NOT NULL,
        account_type TEXT NOT NULL CHECK(account_type IN ('hd', 'imported')),
        hd_wallet_id TEXT,
        derivation_index INTEGER,
        derivation_path TEXT,
        private_key_encrypted TEXT NOT NULL,
        private_key_iv TEXT NOT NULL,
        private_key_tag TEXT NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (hd_wallet_id) REFERENCES hd_wallets(id) ON DELETE CASCADE,
        CHECK (
          (account_type = 'hd' AND hd_wallet_id IS NOT NULL AND derivation_index IS NOT NULL AND derivation_path IS NOT NULL) OR
          (account_type = 'imported' AND hd_wallet_id IS NULL AND derivation_index IS NULL AND derivation_path IS NULL)
        )
      );

      CREATE INDEX idx_accounts_address ON accounts(address);
      CREATE INDEX idx_accounts_name ON accounts(name);
      CREATE INDEX idx_accounts_hd_wallet ON accounts(hd_wallet_id);
      CREATE INDEX idx_accounts_type ON accounts(account_type);

      -- 18. network_rpc_configs table - ENCRYPTED custom URLs
      CREATE TABLE network_rpc_configs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        network_id INTEGER NOT NULL UNIQUE,
        rpc_provider TEXT NOT NULL DEFAULT 'default',
        custom_rpc_url_encrypted TEXT,
        custom_rpc_url_iv TEXT,
        custom_rpc_url_tag TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX idx_network_configs_network ON network_rpc_configs(network_id);

      -- 19. strategy_account_mappings table - Maps strategies to accounts per network
      CREATE TABLE IF NOT EXISTS strategy_account_mappings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        strategy_id TEXT NOT NULL,
        network_id INTEGER NOT NULL,
        account_id TEXT NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (strategy_id) REFERENCES strategies(id) ON DELETE CASCADE,
        FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
        UNIQUE(strategy_id, network_id)
      );

      CREATE INDEX idx_strategy_accounts_strategy ON strategy_account_mappings(strategy_id);
      CREATE INDEX idx_strategy_accounts_network ON strategy_account_mappings(network_id);
      CREATE INDEX idx_strategy_accounts_account ON strategy_account_mappings(account_id);

      -- 20. Orders table (unified across DEX/CEX/hooks)
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        strategy_id TEXT NOT NULL,
        order_type TEXT NOT NULL DEFAULT 'market',
        side TEXT NOT NULL,
        asset_symbol TEXT NOT NULL,
        asset_address TEXT,
        chain_id INTEGER,
        protocol TEXT NOT NULL,
        quantity TEXT NOT NULL,
        price TEXT,
        tick INTEGER,
        status TEXT NOT NULL DEFAULT 'pending',
        filled_quantity TEXT,
        filled_price TEXT,
        tx_hash TEXT,
        hook_order_id TEXT,
        deadline TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (strategy_id) REFERENCES strategies(id) ON DELETE CASCADE
      );

      CREATE INDEX idx_orders_strategy ON orders(strategy_id);
      CREATE INDEX idx_orders_status ON orders(status);

      -- 21. Positions table (FIFO cost basis tracking)
      CREATE TABLE IF NOT EXISTS positions (
        id TEXT PRIMARY KEY,
        strategy_id TEXT NOT NULL,
        asset_symbol TEXT NOT NULL,
        asset_address TEXT,
        chain_id INTEGER,
        side TEXT NOT NULL DEFAULT 'long',
        quantity TEXT NOT NULL DEFAULT '0',
        avg_entry_price TEXT NOT NULL DEFAULT '0',
        current_price TEXT,
        realized_pnl TEXT NOT NULL DEFAULT '0',
        unrealized_pnl TEXT,
        total_fees TEXT NOT NULL DEFAULT '0',
        status TEXT NOT NULL DEFAULT 'open',
        opened_at TEXT DEFAULT (datetime('now')),
        closed_at TEXT,
        FOREIGN KEY (strategy_id) REFERENCES strategies(id) ON DELETE CASCADE
      );

      CREATE INDEX idx_positions_strategy ON positions(strategy_id);
      CREATE INDEX idx_positions_status ON positions(status);

      -- 22. PnL snapshots (hourly)
      CREATE TABLE IF NOT EXISTS pnl_snapshots (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        strategy_id TEXT,
        total_value_usd REAL DEFAULT 0,
        realized_pnl_usd REAL DEFAULT 0,
        unrealized_pnl_usd REAL DEFAULT 0,
        total_pnl_usd REAL DEFAULT 0,
        positions_count INTEGER DEFAULT 0
      );

      CREATE INDEX idx_pnl_snapshots_timestamp ON pnl_snapshots(timestamp);
      CREATE INDEX idx_pnl_snapshots_strategy ON pnl_snapshots(strategy_id);

      -- 23. Trade fills (links trades to positions)
      CREATE TABLE IF NOT EXISTS trade_fills (
        id TEXT PRIMARY KEY,
        trade_id TEXT NOT NULL,
        position_id TEXT NOT NULL,
        action TEXT NOT NULL,
        quantity TEXT NOT NULL,
        price TEXT NOT NULL,
        realized_pnl TEXT DEFAULT '0',
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (trade_id) REFERENCES trades(id) ON DELETE CASCADE,
        FOREIGN KEY (position_id) REFERENCES positions(id) ON DELETE CASCADE
      );

      CREATE INDEX idx_trade_fills_trade ON trade_fills(trade_id);
      CREATE INDEX idx_trade_fills_position ON trade_fills(position_id);
    `)

    console.log('Database schema created successfully')
  } else {
    console.log('Database schema already exists')

    // Run migrations for new tables/columns that may not exist yet
    runMigrations()
  }
}

// Run migrations for tables/columns added after initial schema
function runMigrations() {
  if (!db) return

  // Check and add new tables
  const tablesToCheck = [
    { name: 'orders', sql: `
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        strategy_id TEXT NOT NULL,
        order_type TEXT NOT NULL DEFAULT 'market',
        side TEXT NOT NULL,
        asset_symbol TEXT NOT NULL,
        asset_address TEXT,
        chain_id INTEGER,
        protocol TEXT NOT NULL,
        quantity TEXT NOT NULL,
        price TEXT,
        tick INTEGER,
        status TEXT NOT NULL DEFAULT 'pending',
        filled_quantity TEXT,
        filled_price TEXT,
        tx_hash TEXT,
        hook_order_id TEXT,
        deadline TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (strategy_id) REFERENCES strategies(id) ON DELETE CASCADE
      )
    `},
    { name: 'positions', sql: `
      CREATE TABLE IF NOT EXISTS positions (
        id TEXT PRIMARY KEY,
        strategy_id TEXT NOT NULL,
        asset_symbol TEXT NOT NULL,
        asset_address TEXT,
        chain_id INTEGER,
        side TEXT NOT NULL DEFAULT 'long',
        quantity TEXT NOT NULL DEFAULT '0',
        avg_entry_price TEXT NOT NULL DEFAULT '0',
        current_price TEXT,
        realized_pnl TEXT NOT NULL DEFAULT '0',
        unrealized_pnl TEXT,
        total_fees TEXT NOT NULL DEFAULT '0',
        status TEXT NOT NULL DEFAULT 'open',
        opened_at TEXT DEFAULT (datetime('now')),
        closed_at TEXT,
        FOREIGN KEY (strategy_id) REFERENCES strategies(id) ON DELETE CASCADE
      )
    `},
    { name: 'pnl_snapshots', sql: `
      CREATE TABLE IF NOT EXISTS pnl_snapshots (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        strategy_id TEXT,
        total_value_usd REAL DEFAULT 0,
        realized_pnl_usd REAL DEFAULT 0,
        unrealized_pnl_usd REAL DEFAULT 0,
        total_pnl_usd REAL DEFAULT 0,
        positions_count INTEGER DEFAULT 0
      )
    `},
    { name: 'trade_fills', sql: `
      CREATE TABLE IF NOT EXISTS trade_fills (
        id TEXT PRIMARY KEY,
        trade_id TEXT NOT NULL,
        position_id TEXT NOT NULL,
        action TEXT NOT NULL,
        quantity TEXT NOT NULL,
        price TEXT NOT NULL,
        realized_pnl TEXT DEFAULT '0',
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (trade_id) REFERENCES trades(id) ON DELETE CASCADE,
        FOREIGN KEY (position_id) REFERENCES positions(id) ON DELETE CASCADE
      )
    `}
  ]

  for (const table of tablesToCheck) {
    const exists = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name=?
    `).get(table.name)

    if (!exists) {
      console.log(`Creating table: ${table.name}`)
      db.exec(table.sql)
    }
  }

  // Add new columns to trades table if missing
  const tradeColumns = [
    'expected_output TEXT',
    'actual_output TEXT',
    'slippage_amount TEXT',
    'slippage_percentage REAL',
    'execution_price TEXT',
    'quote_price TEXT',
    'order_id TEXT'
  ]

  for (const colDef of tradeColumns) {
    const colName = colDef.split(' ')[0]
    try {
      db.exec(`ALTER TABLE trades ADD COLUMN ${colDef}`)
      console.log(`Added column trades.${colName}`)
    } catch (e: any) {
      // Column already exists - ignore
      if (!e.message.includes('duplicate column name')) {
        console.error(`Error adding column trades.${colName}:`, e.message)
      }
    }
  }

  // Add Binance fields to api_configs if missing
  const binanceColumns = [
    'binance_api_key_encrypted TEXT',
    'binance_api_key_iv TEXT',
    'binance_api_key_tag TEXT',
    'binance_api_secret_encrypted TEXT',
    'binance_api_secret_iv TEXT',
    'binance_api_secret_tag TEXT'
  ]

  for (const colDef of binanceColumns) {
    const colName = colDef.split(' ')[0]
    try {
      db.exec(`ALTER TABLE api_configs ADD COLUMN ${colDef}`)
      console.log(`Added column api_configs.${colName}`)
    } catch (e: any) {
      if (!e.message.includes('duplicate column name')) {
        console.error(`Error adding column api_configs.${colName}:`, e.message)
      }
    }
  }

  // Add account_id column to trades table
  try {
    db.exec(`ALTER TABLE trades ADD COLUMN account_id TEXT`)
    console.log('Added column trades.account_id')
  } catch (e: any) {
    if (!e.message.includes('duplicate column name')) {
      console.error('Error adding column trades.account_id:', e.message)
    }
  }

  // Add account_id column to positions table
  try {
    db.exec(`ALTER TABLE positions ADD COLUMN account_id TEXT`)
    console.log('Added column positions.account_id')
  } catch (e: any) {
    if (!e.message.includes('duplicate column name')) {
      console.error('Error adding column positions.account_id:', e.message)
    }
  }

  // Add account_id column to orders table
  try {
    db.exec(`ALTER TABLE orders ADD COLUMN account_id TEXT`)
    console.log('Added column orders.account_id')
  } catch (e: any) {
    if (!e.message.includes('duplicate column name')) {
      console.error('Error adding column orders.account_id:', e.message)
    }
  }

  // Add account_id and account_name columns to pnl_snapshots table
  try {
    db.exec(`ALTER TABLE pnl_snapshots ADD COLUMN account_id TEXT`)
    console.log('Added column pnl_snapshots.account_id')
  } catch (e: any) {
    if (!e.message.includes('duplicate column name')) {
      console.error('Error adding column pnl_snapshots.account_id:', e.message)
    }
  }

  try {
    db.exec(`ALTER TABLE pnl_snapshots ADD COLUMN account_name TEXT`)
    console.log('Added column pnl_snapshots.account_name')
  } catch (e: any) {
    if (!e.message.includes('duplicate column name')) {
      console.error('Error adding column pnl_snapshots.account_name:', e.message)
    }
  }

  // Add exchange_name column to strategy_account_mappings for CEX support
  try {
    db.exec(`ALTER TABLE strategy_account_mappings ADD COLUMN exchange_name TEXT`)
    console.log('Added column strategy_account_mappings.exchange_name')
  } catch (e: any) {
    if (!e.message.includes('duplicate column name')) {
      console.error('Error adding column strategy_account_mappings.exchange_name:', e.message)
    }
  }

  // Create account_activity_log table
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS account_activity_log (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        activity_type TEXT NOT NULL,
        description TEXT NOT NULL,
        metadata TEXT,
        chain_id INTEGER,
        tx_hash TEXT,
        amount TEXT,
        timestamp TEXT DEFAULT (datetime('now'))
      )
    `)
    console.log('Created table account_activity_log (if not exists)')
  } catch (e: any) {
    console.error('Error creating account_activity_log table:', e.message)
  }

  // Create strategy_logs table for persistent log storage
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS strategy_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        strategy_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        level TEXT NOT NULL DEFAULT 'info',
        message TEXT NOT NULL,
        timestamp TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (strategy_id) REFERENCES strategies(id) ON DELETE CASCADE
      )
    `)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_strategy_logs_strategy ON strategy_logs(strategy_id)`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_strategy_logs_run ON strategy_logs(run_id)`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_strategy_logs_timestamp ON strategy_logs(timestamp)`)
    console.log('Created table strategy_logs (if not exists)')
  } catch (e: any) {
    console.error('Error creating strategy_logs table:', e.message)
  }
}

// Get database instance
export function getDatabase(): Database.Database {
  if (!db) {
    return initDatabase()
  }
  return db
}

// Query helper for SELECT statements
export function query(sql: string, params: any[] = []): any[] {
  const db = getDatabase()
  const stmt = db.prepare(sql)
  return stmt.all(...params)
}

// Execute helper for INSERT/UPDATE/DELETE
export function execute(sql: string, params: any[] = []): Database.RunResult {
  const db = getDatabase()
  const stmt = db.prepare(sql)
  return stmt.run(...params)
}

// Transaction helper
export function withTransaction<T>(callback: () => T): T {
  const db = getDatabase()
  return db.transaction(callback)()
}

// Close database connection
export function closeDatabase() {
  if (db) {
    db.close()
    db = null
    console.log('Database connection closed')
  }
}
