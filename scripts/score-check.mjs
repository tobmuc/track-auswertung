import fs from 'node:fs';
import IGCParser from 'igc-parser';
import { solver, scoringRules } from 'igc-xc-score';
const flight = IGCParser.parse(fs.readFileSync(process.argv[2], 'utf8'), { lenient: true });
const t0 = Date.now();
let best;
const it = solver(flight, scoringRules.XContest, { maxcycle: 30000, hp: true }); let r; do { r = it.next(); best = r.value; } while (!r.done);
console.log(best.opt.scoring.name, best.score, best.scoreInfo.distance.toFixed(2), 'km', 'penalty', best.scoreInfo.penalty, 'optimal', best.optimal, (Date.now()-t0)+'ms');
console.log('launch/landing idx', best.opt.launch, best.opt.landing, 'fixes', flight.fixes.length);
