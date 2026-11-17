import path from "path";

// Analytics Parquet files live one level above the Next.js client root.
// In development: shipscan/analytics-data/
// In production: set ANALYTICS_DATA_PATH env var to the ADLS Gen2 mount or local path.
export const DATA_PATH =
  process.env.ANALYTICS_DATA_PATH ??
  path.join(process.cwd(), "..", "analytics-data");

export function tableGlob(tableName: string): string {
  return path.join(DATA_PATH, tableName, "*.parquet").replace(/\\/g, "/");
}

// One in-memory DuckDB instance per process, shared across requests.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _instance: any = null;

async function getInstance() {
  if (!_instance) {
    // webpackIgnore prevents webpack from statically analysing this import and
    // trying to bundle the native addon or its platform-specific binaries.
    // At runtime, Node.js resolves it normally from node_modules.
    const duckdb = await import(/* webpackIgnore: true */ "@duckdb/node-api");
    // CJS modules come back as the default export when dynamically imported
    const DuckDBInstance =
      "DuckDBInstance" in duckdb
        ? duckdb.DuckDBInstance
        : (duckdb as { default: { DuckDBInstance: unknown } }).default
            .DuckDBInstance;
    _instance = await (DuckDBInstance as { create(path: string): Promise<unknown> }).create(":memory:");
  }
  return _instance;
}

export interface QueryResult {
  columns: string[];
  rows: unknown[][];
}

export async function runQuery(sql: string): Promise<QueryResult> {
  const instance = await getInstance();
  const conn = await instance.connect();
  try {
    const result = await conn.run(sql);
    const columns = result.columnNames();
    const rows = await result.getRows();
    // @duckdb/node-api returns BigInt for COUNT(*) — normalise to number
    const normalised = rows.map((row: unknown[]) =>
      row.map((v) => (typeof v === "bigint" ? Number(v) : v))
    );
    return { columns, rows: normalised };
  } finally {
    // connection lifecycle is managed by the instance; no explicit close needed
  }
}

export async function runQueryAsObjects(
  sql: string
): Promise<Record<string, unknown>[]> {
  const { columns, rows } = await runQuery(sql);
  return rows.map((row) =>
    Object.fromEntries(columns.map((col, i) => [col, row[i]]))
  );
}
