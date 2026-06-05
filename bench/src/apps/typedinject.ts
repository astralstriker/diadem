import { typedInject } from '../typedinject'
import { report } from './_measure'

report(typedInject.cold().value())
