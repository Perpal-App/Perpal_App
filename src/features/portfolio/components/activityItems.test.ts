import { mergeActivity } from './activityItems';

describe('mergeActivity', () => {
  it('keeps confirmed local trades visible while venue history catches up', () => {
    const items = mergeActivity(null, null, [{
      createdAtMs: 1,
      id: 'trade-1',
      kind: 'trade',
      message: 'Long SOL order confirmed.',
      outcome: 'success',
      readAtMs: null,
      title: 'Velocity order confirmed',
    }]);

    expect(items).toEqual([expect.objectContaining({ kind: 'trade', title: 'Velocity order confirmed' })]);
  });
});
