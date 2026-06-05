import 'reflect-metadata'
import { inversify } from '../inversify'
import { report } from './_measure'

void (async () => {
  report((await inversify.cold()).value())
})()
