import pb from '@/lib/pocketbase/client'
import { UserRecord, UserRole, UserStatus } from '@/types/entities'

export interface CreateUserData {
  email: string
  name: string
  role: UserRole
}

export interface UpdateUserData {
  name?: string
  role?: UserRole
  status?: UserStatus
}

export const usersService = {
  /**
   * Lista todos os usuários cadastrados
   */
  async listUsers(): Promise<UserRecord[]> {
    const records = await pb.collection('users').getFullList<UserRecord>({
      sort: 'name,email',
    })
    return records
  },

  /**
   * Obtém um usuário por ID
   */
  async getUser(id: string): Promise<UserRecord> {
    return await pb.collection('users').getOne<UserRecord>(id)
  },

  /**
   * Cria um colaborador e envia e-mail de convite (via requestPasswordReset)
   * Senha inicial gerada aleatoriamente; o colaborador define a própria senha através do link do e-mail.
   */
  async inviteUser(data: CreateUserData): Promise<UserRecord> {
    // Gerar senha temporária segura de 16 caracteres
    const tempPassword =
      Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-8) + 'A1!'

    const created = await pb.collection('users').create<UserRecord>({
      email: data.email.trim().toLowerCase(),
      name: data.name.trim(),
      role: data.role,
      status: 'pending',
      password: tempPassword,
      passwordConfirm: tempPassword,
    })

    // Disparar o convite por e-mail via requestPasswordReset
    try {
      await pb.collection('users').requestPasswordReset(data.email.trim().toLowerCase())
    } catch (err) {
      console.warn('Falha ao enviar e-mail de convite:', err)
      // Não abortamos a criação, o admin pode clicar em "Reenviar convite"
    }

    return created
  },

  /**
   * Reenvia o e-mail de convite ou de redefinição para um usuário
   */
  async sendPasswordReset(email: string): Promise<void> {
    await pb.collection('users').requestPasswordReset(email.trim().toLowerCase())
  },

  /**
   * Atualiza dados de um colaborador (nome, perfil/role ou status)
   */
  async updateUser(id: string, data: UpdateUserData): Promise<UserRecord> {
    return await pb.collection('users').update<UserRecord>(id, data)
  },

  /**
   * Desativa a conta de um colaborador (status = 'inactive')
   * Sem apagar o histórico de lançamentos e faturas
   */
  async deactivateUser(id: string): Promise<UserRecord> {
    return await pb.collection('users').update<UserRecord>(id, {
      status: 'inactive',
    })
  },

  /**
   * Reativa a conta de um colaborador (status = 'active')
   */
  async activateUser(id: string): Promise<UserRecord> {
    return await pb.collection('users').update<UserRecord>(id, {
      status: 'active',
    })
  },

  /**
   * Atualização do próprio perfil pelo usuário logado (nome)
   */
  async updateMyProfile(name: string): Promise<UserRecord> {
    if (!pb.authStore.record?.id) {
      throw new Error('Usuário não autenticado')
    }
    return await pb.collection('users').update<UserRecord>(pb.authStore.record.id, {
      name: name.trim(),
    })
  },

  /**
   * Desativação da própria conta pelo usuário logado
   */
  async deactivateMyAccount(): Promise<void> {
    if (!pb.authStore.record?.id) {
      throw new Error('Usuário não autenticado')
    }
    await pb.collection('users').update(pb.authStore.record.id, {
      status: 'inactive',
    })
    pb.authStore.clear()
  },
}
