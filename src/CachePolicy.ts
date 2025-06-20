import type { Cache } from 'cache-manager';
import { randomBytes } from 'node:crypto';
import { neverAbortedSignal } from './common/abort';
import { ExecuteWrapper } from './common/Executor';
import { IDefaultPolicyContext, IPolicy } from './Policy';

export type CacheObject = Pick<Cache, 'get' | 'set'>;

/**
 * Based on {@link https://github.com/jaredwray/cacheable/tree/main/packages/cache-manager cache-manager}
 */
export class CachePolicy implements IPolicy {
  declare readonly _altReturn: never;

  /**
   * @inheritdoc
   */
  public readonly onFailure = this.executor.onFailure;

  /**
   * @inheritdoc
   */
  public readonly onSuccess = this.executor.onSuccess;

  protected readonly defaultHash = randomBytes(20).toString('hex');
  protected readonly defaultCacheKey = `${this.constructor.name}::${this.defaultHash}`;

  constructor(
    private readonly cache: CacheObject,
    private readonly executor = new ExecuteWrapper(),
  ) {}

  /**
   * @description You should provide the cache key in the option or pass a named function to use as the cache key.
   * Otherwise the cache policy will use the default cache key which may cause unexpected behavior due to shared cache keys.
   * Unless that is intended behavior.
   */
  public async execute<T>(
    fn: (context: IDefaultPolicyContext) => T | PromiseLike<T>,
    signal: AbortSignal = neverAbortedSignal,
    options?: {
      key?: string;
      ttl?: number;
      shouldCache?: (value: T) => boolean | PromiseLike<boolean>;
    },
  ): Promise<T> {
    const cacheKey =
      options?.key ||
      (fn.name && `${this.constructor.name}::${fn.name}::${this.defaultHash}`) ||
      this.defaultCacheKey;
    const shouldCache = options?.shouldCache ?? ((_value: T) => true);

    const cachedValue = await this.cache.get<T>(cacheKey);
    if (cachedValue !== undefined) {
      return cachedValue;
    }

    const result = await this.executor.invoke(fn, { signal });
    if ('success' in result) {
      if (await shouldCache(result.success)) {
        await this.cache.set(cacheKey, result.success, options?.ttl);
      }

      return result.success;
    }

    if ('error' in result) {
      throw result.error;
    }

    return result.value;
  }
}
