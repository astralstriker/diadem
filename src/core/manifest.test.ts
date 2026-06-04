import { afterEach, describe, expect, it } from 'vitest'
import {
  configureManifest,
  getManifest,
  hasManifest,
  loadManifest,
  resetManifest,
  type ServiceManifestModule
} from './manifest'

const emptyManifest: ServiceManifestModule = {
  SERVICE_CLASSES: {},
  SERVICE_MANIFEST: [],
  getServicesForEnvironment: () => [],
  importService: async () => {
    throw new Error('not implemented')
  },
  importAllServices: async () => []
}

describe('manifest seam', () => {
  afterEach(() => {
    resetManifest()
  })

  it('reports no manifest before configuration', () => {
    resetManifest()
    expect(hasManifest()).toBe(false)
    expect(getManifest()).toBeNull()
  })

  it('registers and returns a configured manifest', async () => {
    configureManifest(emptyManifest)
    expect(hasManifest()).toBe(true)
    expect(getManifest()).toBe(emptyManifest)
    await expect(loadManifest()).resolves.toBe(emptyManifest)
  })

  it('loadManifest throws a helpful error when none is configured', async () => {
    resetManifest()
    await expect(loadManifest()).rejects.toThrowError(/No Diadem service manifest/)
  })

  it('resetManifest clears the registration', () => {
    configureManifest(emptyManifest)
    resetManifest()
    expect(hasManifest()).toBe(false)
  })
})
