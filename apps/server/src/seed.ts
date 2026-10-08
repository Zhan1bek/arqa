import { readFileSync } from 'node:fs';
import { parseTrip } from '@diary/core';
import type { TripRepository } from './repository';

export interface SeedReport {
  created: number;
  skipped: number;
  invalid: Array<{ index: number; issues: string }>;
}

/**
 * Loads demo trips through the same validation and idempotent insert as the API,
 * so restarting the server never duplicates seed data.
 */
export function seedFromFile(repo: TripRepository, filePath: string): SeedReport {
  const data: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
  if (!Array.isArray(data)) throw new Error(`${filePath}: expected a JSON array of trips`);

  const report: SeedReport = { created: 0, skipped: 0, invalid: [] };
  data.forEach((raw, index) => {
    const parsed = parseTrip(raw);
    if (!parsed.ok) {
      report.invalid.push({
        index,
        issues: parsed.issues.map((i) => `${i.field}: ${i.message}`).join('; '),
      });
      return;
    }
    const result = repo.insert(parsed.trip);
    if (result.status === 'created') report.created += 1;
    else report.skipped += 1;
  });
  return report;
}
