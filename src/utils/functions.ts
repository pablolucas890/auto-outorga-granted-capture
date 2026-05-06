import { ClientOrLead, EmailType, GrantedResult, Transport } from '../types';
import nodemailer, { SendMailOptions } from 'nodemailer';
import dotenv from 'dotenv';
import { COLOR_BLACK, COLOR_WHITE, WAIT_TIME_BETWEEN_SENTENCES, WAIT_TIME_BETWEEN_WORDS } from './constants';

dotenv.config({ debug: false, quiet: true });

function escapeHtml(text: string) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function removeAccents(text: string): string {
  return String(text).normalize('NFD').replace(/\p{M}/gu, '');
}

function getUserFriendlyResult(result: GrantedResult, justOneWord = false) {
  const justOneWordGrantedArray = ['Deferimento', 'Autorização', 'Aprovação', 'Concessão'];
  const justOneWordRejectedArray = ['Indeferimento', 'Revogação', 'Negação', 'Recusa'];
  const justOneWordUnknownArray = ['Alteração', 'Modificação', 'Atualização', 'Informação'];

  const sentenceGrantedArray = ['o deferimento', 'a autorização', 'a aprovação', 'a concessão'];
  const sentenceRejectedArray = ['o indeferimento', 'a revogação', 'a negação', 'a recusa'];
  const sentenceUnknownArray = ['uma alteração', 'uma modificação', 'uma atualização', 'uma informação'];

  const situationArray = ['na situação', 'no estado', 'na aprovação', 'na concessão'];

  const random = Math.floor(Math.random() * 4);

  switch (result) {
    case 'granted':
      return justOneWord ? justOneWordGrantedArray[random] : sentenceGrantedArray[random];
    case 'rejected':
      return justOneWord ? justOneWordRejectedArray[random] : sentenceRejectedArray[random];
    case 'unknown':
      return justOneWord
        ? justOneWordUnknownArray[random]
        : sentenceUnknownArray[random] + ' ' + situationArray[random];
  }
}

export async function printSentence(sentence: string, iterativeMode = false) {
  if (!iterativeMode) {
    console.log(sentence.replace(/\n/g, '').replace(/\t/g, ''));
    return;
  }
  let text = '';

  for (let j = 0; j < sentence.split(' ').length; j++) {
    const word = sentence.split(' ')[j];
    text += word + ' ';
    console.clear();
    console.log(text);
    await new Promise(resolve => setTimeout(resolve, WAIT_TIME_BETWEEN_WORDS));
  }
  await new Promise(resolve => setTimeout(resolve, WAIT_TIME_BETWEEN_SENTENCES));
  console.clear();
}

export async function sendEmail(
  client: ClientOrLead,
  title: string,
  paragraph: string,
  url: string,
  departmentName: string,
  result: GrantedResult,
  emailType: EmailType,
  isOutorga: boolean,
) {
  const {
    SMTP_HOST,
    SMTP_PORT,
    SMTP_USER,
    SMTP_PASSWORD,
    CONTACT_NAME,
    CONTACT_PHONE,
    CONTACT_EMAIL,
    WEB_SITE_URL,
    WEB_SITE_LOGO_URL,
    COLOR_PRIMARY,
    COLOR_SECONDARY,
    BCC_EMAIL,
  } = process.env;
  const dept = departmentName?.trim() || 'Meio Ambiente';
  const safeTitle = escapeHtml(title);
  const safeParagraph = escapeHtml(paragraph);
  const safeUrl = escapeHtml(url);
  const replyEmail = CONTACT_EMAIL?.trim() || SMTP_USER?.trim() || '';
  const footerName = CONTACT_NAME?.trim();
  const footerPhone = CONTACT_PHONE?.trim();

  const finalGreetingRandom = Math.floor(Math.random() * 3);
  const finalGreeting =
    finalGreetingRandom === 0 ? 'Com carinho,' : finalGreetingRandom === 1 ? 'Atenciosamente,' : 'Abraços,';
  const textFooter = `
    ${finalGreeting}
    ${footerName ? footerName : ''}
    ${footerPhone ? `Contato: ${footerPhone}` : ''}
    ${replyEmail ? `E-mail: ${replyEmail}` : ''}
  `;
  const htmlFooter = `<p style="margin:1.5em 0 0 0;">${finalGreeting}</p>
    <div style="margin-top:1em;padding-top:1em;border-top:1px solid ${COLOR_SECONDARY};font-size:0.95em;color:${COLOR_BLACK};">
    ${footerName ? `<p style="margin:0.35em 0;">${escapeHtml(footerName)}</p>` : ''}
    ${footerPhone ? `<p style="margin:0.35em 0;">Contato: ${escapeHtml(footerPhone)}</p>` : ''}
    ${
      replyEmail
        ? `<p style="margin:0.35em 0;">E-mail: <a href="mailto:${escapeHtml(replyEmail)}" style="color:${COLOR_PRIMARY};">${escapeHtml(replyEmail)}</a></p>`
        : ''
    }
    </div>
    `;

  let text = '';
  let html = '';

  if (emailType === 'client') {
    text =
      `Olá, ${client.name}!\n\n
    No acompanhamento que realizamos das publicações oficiais, identificamos uma atualização 
    ${isOutorga ? 'sobre o seu processo de outorga' : 'que menciona seu CPF/CNPJ'}.\n\n
    ${isOutorga ? `A publicação indica ${getUserFriendlyResult(result)} do processo, e por isso já quisemos te avisar.\n\n` : ''}
    Órgão / seção: ${dept}\n\n
    Título da publicação:\n${title}\n\n
    Trecho do texto oficial:\n
    ... ${paragraph} ...\n\n
    Para ler a íntegra da publicação no portal oficial do Diário Oficial Eletrônico, acesse o link abaixo.\n\n
    Link da publicação: ${url}\n\n
    A gente entende que informar não é só encaminhar um documento. É também ajudar você acompreender
    o que foi publicado, o que isso representa na prática e quais cuidados podem ser necessários a partir dessa etapa.\n
    Muitas vezes, uma publicação favorável vem acompanhada de condicionantes, prazos ou orientações que merecem atenção.
    Por isso, nosso papel é caminhar junto, traduzindo essas informações de forma clara e responsável.\n
    Caso você queira receber a publicação e entender melhor os próximos passos, é só responder este
    e-mail ou falar com a nossa equipe.\n
    Seguimos à disposição para apoiar você com proximidade, clareza e compromisso em cada etapa do processo.
    ` + textFooter;

    html = `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Open+Sans:ital,wght@0,400;0,600;0,700;1,400&display=swap"
      rel="stylesheet">
    </head>
    <body style="margin:0;padding:0;background-color:${COLOR_PRIMARY};font-family:'Open Sans',Arial;line-height:1.55;color:${COLOR_BLACK};">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
      style="background-color:${COLOR_SECONDARY};border-collapse:collapse;">
      <tr>
        <td align="center" style="padding:0;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
            style="max-width:640px;background-color:${COLOR_WHITE};border-collapse:collapse;">
            <tr>
              <td style="background-color: ${COLOR_WHITE};padding:20px 24px;text-align:center;">
                <a href="${escapeHtml(WEB_SITE_URL || '')}" target="_blank" rel="noopener noreferrer"
                  style="text-decoration:none;display:inline-block;">
                  <img src="${escapeHtml(WEB_SITE_LOGO_URL || '')}" width="280"
                    style="max-width:100%;height:auto;display:block;margin:0 auto;border:0;outline:none;">
                </a>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 28px 32px 28px;font-family:'Open Sans',Arial;">
                <p style="margin:0 0 1em 0;">Olá, ${escapeHtml(client.name)}!</p>
                <p style="margin:0 0 1em 0;">No acompanhamento que realizamos das publicações oficiais, identificamos uma <strong>atualização</strong>
                  ${isOutorga ? 'sobre o seu processo de outorga' : 'que menciona seu CPF/CNPJ'}.
                  ${isOutorga ? `A publicação indica <strong>${getUserFriendlyResult(result)}</strong> do processo, e por isso já quisemos te avisar.\n\n` : ''}
                </p>
                <p style="margin:0 0 1em 0;"><strong>Órgão / seção:</strong> ${escapeHtml(dept)}</p>
                <p style="margin:0 0 0.35em 0;"><strong>Título da publicação</strong></p>
                <p style="margin:0 0 1em 0;">${safeTitle}</p>
                <p style="margin:0 0 0.5em 0;"><strong>Trecho do texto oficial</strong>:</p>
                <blockquote style="margin:0 0 1em 0;padding:1em 1.25em;border-left:4px solid ${COLOR_PRIMARY};background-color:${COLOR_SECONDARY};font-style:italic;color:${COLOR_BLACK};">
                  <p style="margin:0;font-family:'Open Sans',Arial;">… ${safeParagraph} …</p>
                </blockquote>
                <p style="margin:0 0 1em 0;">Para ler a <strong>íntegra</strong> da publicação no portal oficial do
                  Diário Oficial Eletrônico, use o link abaixo.</p>
                <p style="margin:0 0 1em 0;"><a href="${safeUrl}"
                  style="color:${COLOR_PRIMARY};font-weight:600;word-break:break-all;">${safeUrl}</a></p>
                <p style="margin:0 0 1em 0;">A gente entende que informar não é só encaminhar um
                  documento. É também ajudar você a compreender o que foi publicado, o que isso representa na
                  prática e quais cuidados podem ser necessários a partir dessa etapa.</p>
                <p style="margin:0 0 1em 0;">Muitas vezes, uma publicação favorável vem acompanhada de condicionantes,
                  prazos ou orientações que merecem atenção. Por isso, nosso papel é caminhar junto, traduzindo
                  essas informações de forma clara e responsável.</p>
                <p style="margin:0 0 1em 0;">
                  Caso você queira receber a publicação e entender melhor os próximos passos, é só responder este
                  e-mail ou falar com a nossa equipe.
                </p>
                <p style="margin:0 0 1em 0;">Seguimos à disposição para apoiar você com proximidade, clareza e compromisso
                  em cada etapa do processo.</p>
                ${htmlFooter}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
    </body>
    </html>
    `;
  } else if (emailType === 'lead') {
    text =
      `Olá, ${client.name}!\n\n
    Esperamos que esteja tudo bem por aí.\n\n
    No monitoramento que realizamos das publicações oficiais, identificamos uma atualização
    ${isOutorga ? 'envolvendo processo de outorga relacionado à sua empresa' : 'que menciona seu CPF/CNPJ'}.\n\n
    ${
      isOutorga
        ? `A publicação indica ${getUserFriendlyResult(result)} do processo, então decidimos compartilhar essa informação de forma objetiva para apoiar sua leitura inicial.\n\n`
        : ''
    }
    Órgão / seção: ${dept}\n\n
    Título da publicação:\n${title}\n\n
    Trecho do texto oficial:\n
    ... ${paragraph} ...\n\n
    Link da publicação: ${url}\n\n
    Nosso contato aqui é consultivo: sabemos que muitas empresas já possuem parceiros técnicos e respeitamos isso.
    Quando fizer sentido para vocês, podemos atuar de forma complementar na leitura de publicações, interpretação
    prática dos pontos críticos e organização dos próximos passos.\n\n
    Se quiser, você também pode conhecer melhor nossa forma de trabalho e nossa carta de serviços no site:
    ${WEB_SITE_URL}\n\n
    Caso seja útil, seguimos à disposição para uma conversa sem compromisso.
    ` + textFooter;

    html = `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Open+Sans:ital,wght@0,400;0,600;0,700;1,400&display=swap"
      rel="stylesheet">
    </head>
    <body style="margin:0;padding:0;background-color:${COLOR_PRIMARY};font-family:'Open Sans',Arial;line-height:1.55;color:${COLOR_BLACK};">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
      style="background-color:${COLOR_SECONDARY};border-collapse:collapse;">
      <tr>
        <td align="center" style="padding:0;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
            style="max-width:640px;background-color:${COLOR_WHITE};border-collapse:collapse;">
            <tr>
              <td style="background-color: ${COLOR_WHITE};padding:20px 24px;text-align:center;">
                <a href="${escapeHtml(WEB_SITE_URL || '')}" target="_blank" rel="noopener noreferrer"
                  style="text-decoration:none;display:inline-block;">
                  <img src="${escapeHtml(WEB_SITE_LOGO_URL || '')}" width="280"
                    style="max-width:100%;height:auto;display:block;margin:0 auto;border:0;outline:none;">
                </a>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 28px 32px 28px;font-family:'Open Sans',Arial;">
                <p style="margin:0 0 1em 0;">Olá, ${escapeHtml(client.name)}!</p>
                <p style="margin:0 0 1em 0;">Esperamos que esteja tudo bem por aí.</p>
                <p style="margin:0 0 1em 0;">No monitoramento que realizamos das publicações oficiais, identificamos
                  uma atualização
                  ${isOutorga ? 'envolvendo processo de outorga relacionado à sua empresa' : 'que menciona seu CPF/CNPJ'}.
                  ${
                    isOutorga
                      ? `A publicação indica ${getUserFriendlyResult(result)} do processo, então decidimos compartilhar essa informação de forma objetiva para apoiar sua leitura inicial.\n\n`
                      : ''
                  }
                  </p>
                <p style="margin:0 0 1em 0;"><strong>Órgão / seção:</strong> ${escapeHtml(dept)}</p>
                <p style="margin:0 0 0.35em 0;"><strong>Título da publicação</strong></p>
                <p style="margin:0 0 1em 0;">${safeTitle}</p>
                <p style="margin:0 0 0.5em 0;"><strong>Trecho do texto oficial</strong>:</p>
                <blockquote style="margin:0 0 1em 0;padding:1em 1.25em;border-left:4px solid ${COLOR_PRIMARY};background-color:${COLOR_SECONDARY};font-style:italic;color:${COLOR_BLACK};">
                  <p style="margin:0;font-family:'Open Sans',Arial;">… ${safeParagraph} …</p>
                </blockquote>
                <p style="margin:0 0 1em 0;">Para ler a <strong>íntegra</strong> da publicação no portal oficial do
                  Diário Oficial Eletrônico, use o link abaixo.</p>
                <p style="margin:0 0 1em 0;"><a href="${safeUrl}"
                  style="color:${COLOR_PRIMARY};font-weight:600;word-break:break-all;">${safeUrl}</a></p>
                <p style="margin:0 0 1em 0;">Nosso contato aqui é consultivo: sabemos que muitas empresas já possuem
                  parceiros técnicos e respeitamos isso. Quando fizer sentido para vocês, podemos atuar de forma
                  complementar na leitura de publicações, interpretação prática dos pontos críticos e organização
                  dos próximos passos.</p>
                <p style="margin:0 0 1em 0;">Se quiser, você também pode conhecer melhor nossa forma de trabalho e
                  nossa carta de serviços no site:
                  <a href="${escapeHtml(WEB_SITE_URL || '')}" target="_blank" rel="noopener noreferrer"
                    style="color:${COLOR_PRIMARY};font-weight:600;">${escapeHtml(WEB_SITE_URL || '')}</a>
                </p>
                <p style="margin:0 0 1em 0;">Caso seja útil, seguimos à disposição para uma conversa sem compromisso.</p>
                ${htmlFooter}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
    </body>
    </html>
    `;
  } else {
    console.error('Invalid email type');
    return;
  }

  const subjectRandom = Math.floor(Math.random() * 3);
  const subject =
    subjectRandom === 0
      ? `${isOutorga ? `${getUserFriendlyResult(result, true)} de outorga` : 'Menção ao seu CPF/CNPJ no Diário Oficial'}`
      : subjectRandom === 1
        ? `[${isOutorga ? `${getUserFriendlyResult(result, true)} de outorga` : `[Atualização] Sobre seu processo no departamento de ${dept}`}]`
        : `${isOutorga ? `${getUserFriendlyResult(result, true)} de outorga` : 'Meio Ambiente, Atualização sobre seu processo!'}`;
  const bccEmail = BCC_EMAIL?.trim() || '';
  const bcc = emailType === 'client' ? [bccEmail, replyEmail] : [bccEmail];
  const mail: SendMailOptions = {
    from: SMTP_USER,
    to: client.email || '',
    replyTo: replyEmail,
    bcc,
    subject,
    text,
    html,
  };

  const transportOptions: Transport = {
    host: SMTP_HOST || '',
    port: SMTP_PORT ? parseInt(SMTP_PORT) : 0,
    secure: true,
    auth: { user: SMTP_USER || '', pass: SMTP_PASSWORD || '' },
    logger: false,
    debug: false,
    name: WEB_SITE_URL?.trim()?.split('//')[1]?.split('/')[0] || '',
    from: `"${CONTACT_NAME?.trim()}" <${CONTACT_EMAIL?.trim()}>`,
  };
  try {
    const smtpTransport = nodemailer.createTransport(transportOptions);
    await smtpTransport.sendMail(mail);
  } catch (error) {
    console.log('Error sending email:', error);
  }
}

export function determineGrantedResult(paragraph: string): GrantedResult {
  if (paragraph.includes('Fica outorgada')) {
    return 'granted';
  } else if (paragraph.includes('Fica revogada')) {
    return 'rejected';
  }
  return 'unknown';
}
