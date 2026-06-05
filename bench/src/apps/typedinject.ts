import { typedInject } from '../typedinject'
import { report } from './_measure'

void (async () => {
  report((await typedInject.cold()).value())
})()
