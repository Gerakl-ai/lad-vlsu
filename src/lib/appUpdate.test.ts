import { describe, expect, it } from 'vitest';
import { canApplyAppUpdate } from './appUpdate';

describe('safe application update', () => {
  it('allows an update on a visible idle screen', () => {
    expect(canApplyAppUpdate({ hidden: false, dialogOpen: false, editing: false })).toBe(true);
  });
  it.each([
    { hidden: true, dialogOpen: false, editing: false },
    { hidden: false, dialogOpen: true, editing: false },
    { hidden: false, dialogOpen: false, editing: true }
  ])('defers when the screen or editor is busy: %j', (state) => {
    expect(canApplyAppUpdate(state)).toBe(false);
  });
});
