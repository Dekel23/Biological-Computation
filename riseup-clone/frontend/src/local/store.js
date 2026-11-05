/**
 * Persistence for phone mode: the whole household lives in one IndexedDB record on
 * the device. Every operation runs through a queue, so a background job (e.g. the
 * weekly summary) never interleaves with a user action.
 */
import { SCHEMA_VERSION } from './seed'

const DB_NAME = 'bottom-line'
const STORE = 'state'
const KEY = 'household'

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idb(mode, fn) {
  const db = await openDb()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      const req = fn(tx.objectStore(STORE))
      tx.oncomplete = () => resolve(req?.result)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

export const readState = () => idb('readonly', (s) => s.get(KEY))
export const writeState = (state) => idb('readwrite', (s) => s.put(state, KEY))

/** Ask the browser not to evict our data under storage pressure (best effort). */
export async function requestPersistence() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist()
  } catch {
    /* not supported – data is still stored, just evictable */
  }
}

export function validateBackup(data) {
  const required = ['user', 'categories', 'transactions', 'rules', 'budgets', 'fixedExpenses', 'goals', 'messages']
  if (!data || typeof data !== 'object' || required.some((k) => !(k in data))) {
    throw new Error('This file is not a Bottom Line backup.')
  }
  if ((data.version ?? 0) > SCHEMA_VERSION) throw new Error('This backup comes from a newer version of the app.')
  return {
    accounts: [], alertLogs: [], nextId: {},
    meta: { demo: false, unread: 0, lastWeekly: null, lastDaily: null, phoneNotifications: false },
    ...data,
    version: SCHEMA_VERSION,
  }
}

export function createQueue(load) {
  let state = null
  let chain = Promise.resolve()
  return {
    /** Run `fn(state)`; when `mutate` is set the state is saved afterwards. */
    run(fn, { mutate = false } = {}) {
      const next = chain.then(async () => {
        if (!state) state = await load()
        const result = await fn(state)
        if (mutate) await writeState(state)
        return result
      })
      chain = next.catch(() => {})
      return next
    },
    /** Replace the whole state (restore / start fresh). */
    replace(newState) {
      const next = chain.then(async () => {
        state = newState
        await writeState(state)
      })
      chain = next.catch(() => {})
      return next
    },
  }
}
