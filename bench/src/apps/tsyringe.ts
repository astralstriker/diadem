import 'reflect-metadata'
import { tsyringe } from '../tsyringe'
import { report } from './_measure'

report(tsyringe.cold().value())
