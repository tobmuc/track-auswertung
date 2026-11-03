import Dexie, { type Table } from 'dexie';
import type { DemGrid } from './ground';
import type { Poi } from './pois';
import type { ActivityRecord } from './types';

class TrackDB extends Dexie {
  activities!: Table<ActivityRecord, number>;
  /** OpenTopography tiles, key = "<dem>/<tx>/<ty>" */
  dem!: Table<{ key: string; grid: DemGrid; createdAt: number }, string>;
  /** DEM files imported by the user */
  demFiles!: Table<{ id?: number; name: string; grid: DemGrid; createdAt: number }, number>;
  /** POIs per area and language, key = "<lang>|<w>,<s>,<e>,<n>" */
  pois!: Table<{ key: string; pois: Poi[]; createdAt: number }, string>;
  constructor() {
    super('track-auswertung');
    this.version(1).stores({ activities: '++id, date, createdAt' });
    this.version(2).stores({ activities: '++id, date, createdAt', dem: 'key', demFiles: '++id, name' });
    this.version(3).stores({ activities: '++id, date, createdAt', dem: 'key', demFiles: '++id, name', pois: 'key' });
  }
}

export const db = new TrackDB();
