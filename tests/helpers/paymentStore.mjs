// Test double for handler contracts. Real Redis atomicity is provided by the Lua scripts.
export class MemoryPaymentStore {
  records = new Map()
  counters = new Map()
  sequence = 0
  unavailable = false
  async insert(event, fingerprint) {
    this.check()
    const old = this.records.get(event.id)
    if (old) {
      if (old.fingerprint !== fingerprint) throw new Error("ID_CONFLICT")
      return { event: old.event, duplicate: true }
    }
    const saved = { ...event, sequence: ++this.sequence }
    this.records.set(event.id, { event: saved, fingerprint })
    return { event: saved, duplicate: false }
  }
  async list(cursor) {
    this.check()
    if (cursor === undefined) return { events: [], cursor: this.sequence }
    if (cursor > this.sequence) throw new Error("CURSOR_INVALID")
    return {
      events: [...this.records.values()]
        .map((record) => record.event)
        .filter((event) => event.sequence > cursor),
      cursor: this.sequence,
    }
  }
  async transition(id, operation, owner, now, qr, commitId) {
    this.check()
    const record = this.records.get(id)
    if (!record || record.event.receivedAt + 86400000 <= now) return false
    if (operation === "reserve") {
      if (
        record.consumed ||
        (record.owner && record.owner !== owner && record.leaseUntil > now)
      )
        return false
      record.owner = owner
      record.leaseUntil = now + 300000
    } else if (operation === "release") {
      if (record.consumed || record.owner !== owner) return false
      delete record.owner
      delete record.leaseUntil
    } else {
      if (record.consumed)
        return (
          record.owner === owner &&
          record.commitId === commitId &&
          record.event.montoCentavos === qr
        )
      if (
        record.owner !== owner ||
        record.leaseUntil <= now ||
        record.event.montoCentavos !== qr
      )
        return false
      record.consumed = true
      record.commitId = commitId
    }
    return true
  }
  async limit(key, maximum) {
    this.check()
    const value = (this.counters.get(key) ?? 0) + 1
    this.counters.set(key, value)
    return value <= maximum
  }
  check() {
    if (this.unavailable) throw new Error("Redis secret must never leak")
  }
}

export class MemoryStorage {
  items = new Map()
  getItem(key) {
    return this.items.get(key) ?? null
  }
  setItem(key, value) {
    this.items.set(key, value)
  }
  removeItem(key) {
    this.items.delete(key)
  }
  clear() {
    this.items.clear()
  }
  key(index) {
    return [...this.items.keys()][index] ?? null
  }
  get length() {
    return this.items.size
  }
}
