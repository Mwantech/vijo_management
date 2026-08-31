class TtlCache {
  constructor() {
    this.values = new Map()
    this.inflight = new Map()
  }

  async getOrLoad(key, ttlMs, loader) {
    const cached = this.values.get(key)
    if (cached && cached.expiresAt > Date.now()) return cached.value
    if (this.inflight.has(key)) return this.inflight.get(key)
    const promise = Promise.resolve(loader()).then((value) => {
      this.values.set(key, { value, expiresAt: Date.now() + ttlMs })
      return value
    }).finally(() => this.inflight.delete(key))
    this.inflight.set(key, promise)
    return promise
  }

  clear(prefix) {
    for (const key of this.values.keys()) if (!prefix || key.startsWith(prefix)) this.values.delete(key)
  }
}

export const cache = new TtlCache()
