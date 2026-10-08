import { DatabaseSync } from 'node:sqlite';
import { localDateOf, type PaymentMethod, type TripInput } from '@diary/core';

/** A trip as stored: instants are epoch ms, `localDate` is the driver-local day of `start`. */
export interface StoredTrip {
  id: string;
  startMs: number;
  endMs: number;
  localDate: string;
  amount: number;
  commission: number;
  payment: PaymentMethod;
}

export type InsertResult =
  | { status: 'created'; trip: StoredTrip }
  | { status: 'duplicate'; trip: StoredTrip }
  | { status: 'conflict'; trip: StoredTrip };

// The CHECKs duplicate core validation on purpose: the database is the last line of defense
// for money (ADR-0001) and the PRIMARY KEY is what makes writes idempotent (ADR-0003).
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS trips (
    id          TEXT    PRIMARY KEY,
    start_ms    INTEGER NOT NULL,
    end_ms      INTEGER NOT NULL,
    local_date  TEXT    NOT NULL,
    amount      INTEGER NOT NULL CHECK (amount > 0),
    commission  INTEGER NOT NULL CHECK (commission >= 0 AND commission <= amount),
    payment     TEXT    NOT NULL CHECK (payment IN ('cash', 'card')),
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK (end_ms > start_ms)
  );
  CREATE INDEX IF NOT EXISTS trips_by_day ON trips (local_date, start_ms);
`;

interface TripRow {
  id: string;
  start_ms: number;
  end_ms: number;
  local_date: string;
  amount: number;
  commission: number;
  payment: PaymentMethod;
}

const COLUMNS = 'id, start_ms, end_ms, local_date, amount, commission, payment';

function fromRow(row: TripRow): StoredTrip {
  return {
    id: row.id,
    startMs: row.start_ms,
    endMs: row.end_ms,
    localDate: row.local_date,
    amount: row.amount,
    commission: row.commission,
    payment: row.payment,
  };
}

/** Same trip "by meaning": instants are compared, not their string representations. */
function sameTrip(a: StoredTrip, b: StoredTrip): boolean {
  return (
    a.startMs === b.startMs &&
    a.endMs === b.endMs &&
    a.amount === b.amount &&
    a.commission === b.commission &&
    a.payment === b.payment
  );
}

export class TripRepository {
  private readonly db: DatabaseSync;

  constructor(
    dbPath: string,
    private readonly timeZone: string,
  ) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    this.db.exec(SCHEMA);
  }

  /**
   * Idempotent insert keyed by trip id (ADR-0003). Uniqueness is enforced by the PRIMARY KEY
   * via ON CONFLICT DO NOTHING, so there is no check-then-insert race.
   */
  insert(input: TripInput): InsertResult {
    const trip: StoredTrip = {
      id: input.id,
      startMs: Date.parse(input.start),
      endMs: Date.parse(input.end),
      localDate: localDateOf(input.start, this.timeZone),
      amount: input.amount,
      commission: input.commission,
      payment: input.payment,
    };

    const { changes } = this.db
      .prepare(
        `INSERT INTO trips (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
      )
      .run(
        trip.id,
        trip.startMs,
        trip.endMs,
        trip.localDate,
        trip.amount,
        trip.commission,
        trip.payment,
      );
    if (Number(changes) === 1) return { status: 'created', trip };

    const existing = this.findById(trip.id);
    if (!existing) throw new Error(`Trip ${trip.id} conflicted on insert but was not found`);
    return { status: sameTrip(existing, trip) ? 'duplicate' : 'conflict', trip: existing };
  }

  findById(id: string): StoredTrip | undefined {
    const row = this.db.prepare(`SELECT ${COLUMNS} FROM trips WHERE id = ?`).get(id);
    return row ? fromRow(row as unknown as TripRow) : undefined;
  }

  listByDay(localDate: string): StoredTrip[] {
    const rows = this.db
      .prepare(`SELECT ${COLUMNS} FROM trips WHERE local_date = ? ORDER BY start_ms, id`)
      .all(localDate);
    return (rows as unknown as TripRow[]).map(fromRow);
  }

  listDays(limit = 366): Array<{ date: string; trips: number }> {
    const rows = this.db
      .prepare(
        `SELECT local_date AS date, COUNT(*) AS trips FROM trips
         GROUP BY local_date ORDER BY local_date DESC LIMIT ?`,
      )
      .all(limit);
    return rows as unknown as Array<{ date: string; trips: number }>;
  }

  close(): void {
    this.db.close();
  }
}
