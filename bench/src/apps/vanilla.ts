import { vanilla } from '../vanilla'
import { report } from './_measure'

void (async () => {
  report((await vanilla.cold()).value())
})()
