import Dexie, { type Table } from 'dexie';
import type { DemGrid } from './ground';
import type { ActivityRecord } from './types';

class TrackDB extends Dexie {
  activities!: Table<ActivityRecord, number>;
  /** OpenTopography tiles, key = "<dem>/<tx>/<ty>" */
  dem!: Table<{ key: string; grid: DemGrid; createdAt: number }, string>;
  /** DEM files imported by the user */
  demFiles!: Table<{ id?: number; name: string; grid: DemGrid; createdAt: number }, number>;
  constructor() {
    super('track-auswertung');
    this.version(1).stores({ activities: '++id, date, createdAt' });
    this.version(2).stores({ activities: '++id, date, createdAt', dem: 'key', demFiles: '++id, name' });
  }
}

export const db = new TrackDB();
