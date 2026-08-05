import type { GatewayConfig } from './env';

const REDIS_TIMEOUT_MS = 2_000;

type RedisResponse<T> = {
  readonly result?: T;
  readonly error?: string;
};

/** Minimal Upstash REST boundary for replay and idempotency state. */
export class RedisStore {
  constructor(private readonly config: NonNullable<GatewayConfig['redis']>) {}

  async reserve(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.command<string | null>([
      'SET',
      key,
      value,
      'NX',
      'EX',
      String(ttlSeconds),
    ]);

    return result === 'OK';
  }

  async get(key: string): Promise<string | null> {
    return this.command<string | null>(['GET', key]);
  }

  async put(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.command<string>(['SET', key, value, 'EX', String(ttlSeconds)]);
  }

  async delete(key: string): Promise<void> {
    await this.command<number>(['DEL', key]);
  }

  private async command<T>(command: readonly string[]): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REDIS_TIMEOUT_MS);

    try {
      const response = await fetch(this.config.url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.config.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(command),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Redis responded ${response.status}.`);
      }

      const payload = (await response.json()) as RedisResponse<T>;

      if (payload.error !== undefined || !Object.hasOwn(payload, 'result')) {
        throw new Error('Redis command failed.');
      }

      return payload.result as T;
    } finally {
      clearTimeout(timeout);
    }
  }
}
