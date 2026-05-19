const DELAYS_MS = [1000, 4000, 16000];

export async function withRetry<T>(
  stage: string,
  fn: () => Promise<T>,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i <= DELAYS_MS.length; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = (e as Error).message ?? String(e);
      if (i === DELAYS_MS.length) {
        console.error(`[${stage}] failed after ${i + 1} attempts: ${msg}`);
        throw e;
      }
      const wait = DELAYS_MS[i]!;
      console.error(`[${stage}] attempt ${i + 1} failed: ${msg}; retry in ${wait}ms`);
      await Bun.sleep(wait);
    }
  }
  throw lastErr;
}
