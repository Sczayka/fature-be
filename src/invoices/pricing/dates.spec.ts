import { startOfDayInBillingTimezone } from './dates.js';

describe('startOfDayInBillingTimezone', () => {
  it('starts the day at midnight in São Paulo (03:00 UTC)', () => {
    expect(startOfDayInBillingTimezone('2026-10-01')).toEqual(
      new Date('2026-10-01T03:00:00Z'),
    );
  });

  it('keeps the calendar across the turn of the year', () => {
    expect(startOfDayInBillingTimezone('2027-01-01')).toEqual(
      new Date('2027-01-01T03:00:00Z'),
    );
  });
});
