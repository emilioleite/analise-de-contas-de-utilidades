// Hooks para gestão de usuários e personalização de e-mails de convite e redefinição de senha
// Marca: Gestor de Utilidades — Dekazen

// 1. Personalizar e-mails de redefinição de senha / convite
onMailerRecordPasswordResetSend((e) => {
  const user = e.record
  const status = user.getString('status')
  const userName = user.getString('name') || user.email() || 'Colaborador'
  const isInvite = status === 'pending'

  // O actionUrl padrão ou link do e-mail contém o token.
  // No PocketBase v0.36+, e.message.html e e.message.subject podem ser customizados
  if (isInvite) {
    e.message.subject = 'Convite para o Gestor de Utilidades — Dekazen'
  } else {
    e.message.subject = 'Redefinição de senha — Gestor de Utilidades — Dekazen'
  }

  // O corpo do e-mail pode ser estilizado em HTML corporativo e elegante em pt-BR
  const originalHtml = e.message.html || ''

  // Extrair o link do botão original se existir
  let actionUrl = ''
  const hrefMatch = originalHtml.match(/href="([^"]+)"/i)
  if (hrefMatch && hrefMatch[1]) {
    actionUrl = hrefMatch[1]
  }

  const titleText = isInvite
    ? 'Bem-vindo ao Gestor de Utilidades'
    : 'Redefinição de Senha de Acesso'

  const introText = isInvite
    ? `Olá, <strong>${userName}</strong>!<br/><br/>Você foi convidado para acessar a plataforma corporativa <strong>Gestor de Utilidades — Dekazen</strong> como colaborador.`
    : `Olá, <strong>${userName}</strong>!<br/><br/>Recebemos uma solicitação para redefinir a senha da sua conta corporativa no <strong>Gestor de Utilidades — Dekazen</strong>.`

  const buttonText = isInvite ? 'Ativar Conta e Criar Senha' : 'Redefinir Minha Senha'

  const secondaryText = isInvite
    ? 'Clique no botão acima para cadastrar sua senha de acesso e começar a utilizar a plataforma.'
    : 'Se você não solicitou a alteração da sua senha, por favor ignore esta mensagem com segurança.'

  const fallbackLink = actionUrl
    ? `<p style="font-size: 11px; color: #64748b; margin-top: 24px; word-break: break-all;">
         Se o botão não funcionar, copie e cole o link no seu navegador:<br/>
         <a href="${actionUrl}" style="color: #0f766e;">${actionUrl}</a>
       </p>`
    : ''

  const customHtml = `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <title>${e.message.subject}</title>
  </head>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 32px 16px;">
    <div style="max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
      <div style="background-color: #0f766e; padding: 24px 32px; text-align: left;">
        <h1 style="color: #ffffff; margin: 0; font-size: 18px; font-weight: 700; letter-spacing: -0.02em;">
          Gestor de Utilidades
        </h1>
        <p style="color: #99f6e4; margin: 4px 0 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; font-weight: 600;">
          DEKAZEN
        </p>
      </div>
      <div style="padding: 32px; color: #1e293b; line-height: 1.6;">
        <h2 style="font-size: 18px; font-weight: 700; color: #0f172a; margin-top: 0; margin-bottom: 16px;">
          ${titleText}
        </h2>
        <p style="font-size: 14px; margin-bottom: 24px;">
          ${introText}
        </p>
        ${
          actionUrl
            ? `<div style="text-align: center; margin: 32px 0;">
                <a href="${actionUrl}" style="background-color: #0f766e; color: #ffffff; text-decoration: none; padding: 12px 28px; font-size: 14px; font-weight: 600; border-radius: 8px; display: inline-block;">
                  ${buttonText}
                </a>
              </div>`
            : ''
        }
        <p style="font-size: 13px; color: #475569;">
          ${secondaryText}
        </p>
        ${fallbackLink}
      </div>
      <div style="background: #f1f5f9; padding: 16px 32px; text-align: center; font-size: 11px; color: #64748b; border-top: 1px solid #e2e8f0;">
        Gestor de Utilidades — Dekazen © ${new Date().getFullYear()} • Plataforma Corporativa de Utilidades e GEE
      </div>
    </div>
  </body>
  </html>
  `

  e.message.html = customHtml
  e.next()
})

// 2. Impedir login de usuários com status 'inactive'
onRecordAuthRequest((e) => {
  const user = e.record
  if (user) {
    const status = user.getString('status')
    if (status === 'inactive') {
      throw new ForbiddenError(
        'Sua conta de usuário foi desativada. Entre em contato com um administrador corporativo.',
      )
    }
  }
  e.next()
}, 'users')

// 3. Ao redefinir a senha com sucesso, se o usuário estava como 'pending', ativar a conta
onRecordConfirmPasswordResetRequest((e) => {
  e.next()
  try {
    const user = e.record
    if (user && user.getString('status') === 'pending') {
      user.set('status', 'active')
      e.app.save(user)
    }
  } catch (err) {
    console.log('[onRecordConfirmPasswordResetRequest] Erro ao ativar usuário:', err)
  }
}, 'users')
