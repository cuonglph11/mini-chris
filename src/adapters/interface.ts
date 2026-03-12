export { type Adapter, type AdapterEvent } from '../types.js';

import { type Adapter } from '../types.js';
import { type AppConfig } from '../types.js';
import { CursorAdapter } from './cursor.js';
import { CopilotAdapter } from './copilot.js';

export function createAdapter(name: 'cursor' | 'copilot', config: AppConfig): Adapter {
  switch (name) {
    case 'cursor':
      return new CursorAdapter(config);
    case 'copilot':
      return new CopilotAdapter(config);
    default: {
      const _exhaustive: never = name;
      throw new Error(`Unknown adapter: ${_exhaustive as string}`);
    }
  }
}
