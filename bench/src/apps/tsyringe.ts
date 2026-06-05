import 'reflect-metadata'
import { tsyringe } from '../tsyringe'
import { report } from './_measure'

void (async () => {
  report((await tsyringe.cold()).value())
})()
