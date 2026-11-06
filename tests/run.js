// SPDX-License-Identifier: GPL-2.0-or-later
// Runs every test file. Use: gjs -m tests/run.js  (or `make test`)
import System from 'system';
import {summary} from './harness.js';

print('sun.js');
await import('./sun.test.js');
print('\nschedule.js');
await import('./schedule.test.js');

System.exit(summary() ? 0 : 1);
