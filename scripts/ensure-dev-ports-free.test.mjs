import assert from 'node:assert/strict';
import test from 'node:test';

import { getDevPorts } from './ensure-dev-ports-free.mjs';

test('getDevPorts returns the default admin, api, and HMR ports', () => {
  assert.deepEqual(getDevPorts({}), [3010, 3011, 24679]);
});

test('getDevPorts accepts project env overrides and removes duplicates', () => {
  assert.deepEqual(
    getDevPorts({
      ADMIN_UI_PORT: '4010',
      PORT: '4011',
      ADMIN_UI_HMR_PORT: '4010',
    }),
    [4010, 4011],
  );
});
