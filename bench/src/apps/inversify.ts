import 'reflect-metadata'
import { inversify } from '../inversify'
import { report } from './_measure'

report(inversify.cold().value())
