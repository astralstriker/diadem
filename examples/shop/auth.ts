import { singleton } from '@devcraft-ts/diadem'
import { IConfig, ILogger } from './infrastructure'
import { IUserRepository } from './repositories'

export abstract class IPasswordHasher {
  abstract verify(plain: string, hash: string): boolean
}

@singleton(IPasswordHasher)
export class PasswordHasher extends IPasswordHasher {
  constructor(private readonly config: IConfig) {
    super()
  }
  verify(plain: string, hash: string): boolean {
    // a real impl would use the cost factor from config
    void this.config.get('BCRYPT_ROUNDS')
    return plain.length > 0 && hash.length > 0
  }
}

export abstract class IAuthService {
  abstract login(email: string, password: string): boolean
}

@singleton(IAuthService)
export class AuthService extends IAuthService {
  constructor(
    private readonly users: IUserRepository,
    private readonly hasher: IPasswordHasher,
    private readonly logger: ILogger
  ) {
    super()
  }
  login(email: string, password: string): boolean {
    const user = this.users.findByEmail(email)
    if (!user) {
      this.logger.info(`login failed: no such user ${email}`)
      return false
    }
    return this.hasher.verify(password, user.passwordHash)
  }
}
