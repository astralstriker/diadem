import { DiademContainer, configureManifest } from '@devcraft-ts/diadem'
import type { Framework } from '../types'
import { createContainer } from './generated/container'
import * as manifest from './generated/manifest'
import { IApp } from './services'

configureManifest(manifest)

// Compiled mode: straight-line createContainer(), then a cached resolve.
export const diademCompiled: Framework = {
  name: 'diadem (compiled)',
  cold: () => createContainer().resolve(IApp),
  makeHot: () => {
    const c = createContainer()
    return () => c.resolve(IApp)
  }
}

// Manifest mode: interpret the generated manifest at runtime.
export const diademManifest: Framework = {
  name: 'diadem (manifest)',
  cold: async () => {
    const c = new DiademContainer()
    await c.autoRegisterDiscovered('production')
    return c.resolve(IApp)
  },
  makeHot: async () => {
    const c = new DiademContainer()
    await c.autoRegisterDiscovered('production')
    return () => c.resolve(IApp)
  }
}
