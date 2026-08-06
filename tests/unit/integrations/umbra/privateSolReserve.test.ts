import { privateSolReserveDeficit } from '@/integrations/umbra/privateSolReserve';

describe('privateSolReserveDeficit', () => {
  it('wraps only the missing user-funded reserve and rejects invalid amounts', () => {
    expect(privateSolReserveDeficit(20n, 7n)).toBe(13n);
    expect(privateSolReserveDeficit(20n, 20n)).toBe(0n);
    expect(privateSolReserveDeficit(20n, 30n)).toBe(0n);
    expect(() => privateSolReserveDeficit(0n, 0n)).toThrow();
    expect(() => privateSolReserveDeficit(1n, -1n)).toThrow();
  });
});
