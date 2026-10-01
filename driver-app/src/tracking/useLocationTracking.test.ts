import { describe, expect, it, vi } from 'vitest'

// The real client and adapter pull in react-native and expo; only the two
// error classes matter here, with the real constructor signatures.
vi.mock('../api/client', () => ({
  api: {},
  ApiError: class ApiError extends Error {
    status: number
    constructor(status: number) { super(`HTTP ${status}`); this.status = status }
  },
  NetworkError: class NetworkError extends Error {
    timedOut: boolean
    constructor(_cause: unknown, timedOut = false) { super('Cannot reach the server'); this.timedOut = timedOut }
  },
}))
vi.mock('./adapter', () => ({ expoLocationAdapter: {} }))
vi.mock('./queueStorage', () => ({ createQueueStore: () => null }))

import { ApiError, NetworkError } from '../api/client'
import { classifyUploadError } from './useLocationTracking'

describe('classifyUploadError', () => {
  it('passes OUR timeout through to the tracker, which halves the backlog batch on it', () => {
    expect(classifyUploadError(new NetworkError(new Error('aborted'), true))).toMatchObject({ retryable: true, timedOut: true })
    expect(classifyUploadError(new NetworkError(new Error('no signal'))).timedOut).toBeFalsy()
    const busy = classifyUploadError(new ApiError(503, null, 'busy'))
    expect(busy.retryable).toBe(true)
    expect(busy.timedOut).toBeFalsy()
  })
})
