import { clone, delay, now } from './core'
import { getDb, setDb, type Db } from './db'
import { advanceLifecycle } from './views'

/**
 * The single doorway to the demo data, used by every API function so they all behave alike:
 *  - `read` pauses briefly (a believable round trip), lets the scheduler catch up, and hands back a deep COPY, so a screen can
 *    never mutate the store by accident;
 *  - `write` does the same, runs the change as one all-or-nothing step (a thrown error rolls everything back, like a database
 *    transaction), and tells the open screens something changed.
 */

type Listener = () => void
const listeners = new Set<Listener>()

/** Subscribe to "the data changed" (what Realtime does in the real app). Returns an unsubscribe function. */
export function onDataChange(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export async function read<T>(query: (db: Db, at: Date) => T): Promise<T> {
  await delay()
  const db = getDb()
  const at = now()
  advanceLifecycle(db, at)
  return clone(query(db, at))
}

export async function write<T>(change: (db: Db, at: Date) => T): Promise<T> {
  await delay()
  const before = getDb()
  const snapshot = clone(before)
  const at = now()
  let result: T
  try {
    advanceLifecycle(before, at)
    result = clone(change(before, at))
  } catch (err) {
    setDb(snapshot)
    throw err
  }
  // announce only after the change is safely done, so a misbehaving listener can never undo it
  for (const listener of listeners) {
    try { listener() } catch (err) { console.error('[demo] a data-change listener failed', err) }
  }
  return result
}
