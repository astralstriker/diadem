// Compiled-mode production path: only the compiled container + diadem runtime
// (no manifest, no auto-discovery).
import { createContainer } from '../diadem/generated/container'
import { IApp } from '../diadem/services'
import { report } from './_measure'

report(createContainer().resolve(IApp).value())
