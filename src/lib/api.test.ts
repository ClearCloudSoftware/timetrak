import { describe, it, expect } from 'vitest';
import * as api from './api';

describe('api', () => {
  it('exports a startTimer function', () => {
    expect(typeof api.startTimer).toBe('function');
  });
});
