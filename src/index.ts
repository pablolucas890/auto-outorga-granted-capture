import * as cheerio from 'cheerio';
import dotenv from 'dotenv';
import fs from 'fs';
import nodemailer, { SendMailOptions } from 'nodemailer';

dotenv.config({ debug: false, quiet: true });

const HEADERS = {
  accept: 'application/json, text/plain, */*',
  'accept-language': 'en-US,en;q=0.5',
  origin: 'https://doe.sp.gov.br',
  dnt: '1',
  referer: 'https://doe.sp.gov.br/',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-site',
  te: 'trailers',
};
const ENDPOINT_URL = 'https://do-api-web-search.doe.sp.gov.br/v2/summary/structured';
const JOURNAL_ID = 'ca96256b-6ca1-407f-866e-567ef9430123';
const SECTION_ID = '257b103f-1eb2-4f24-a170-4e553c7e4aac';
const URL = `${ENDPOINT_URL}?JournalId=${JOURNAL_ID}&SectionId=${SECTION_ID}&Date=`;
const CLIENTS: Client[] =
  JSON.parse(fs.existsSync('data/clients.json') ? fs.readFileSync('data/clients.json', 'utf8') : '[]') || [];
const WAIT_TIME_BETWEEN_SENTENCES = 2000;
const WAIT_TIME_BETWEEN_WORDS = 50;
const COLOR_WHITE = '#FFFFFF';
const COLOR_BLACK = '#000000';

type GrantedResult = 'granted' | 'rejected' | 'unknown';

interface Client {
  name: string;
  cnpj: string;
  email: string | null;
}

interface Outorga {
  title: string;
  slug: string;
  departmentName: string;
}

interface PublicationResponse {
  content: string;
}

interface Publication {
  title: string;
  slug: string;
  departmentName: string;
}

interface Act {
  name: string;
  children: Child[];
}

interface Child {
  name: string;
  children: Child[];
  publications: Publication[];
}

interface Transport {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
}

function escapeHtml(text: string) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getUserFriendlyResult(result: GrantedResult, justOneWord = false) {
  switch (result) {
    case 'granted':
      return justOneWord ? 'Deferimento' : 'o deferimento';
    case 'rejected':
      return justOneWord ? 'Indeferimento' : 'o indeferimento';
    case 'unknown':
      return justOneWord ? 'Alteração' : 'uma alteração na situação';
  }
}

async function printSentence(sentence: string, iterativeMode = false) {
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

async function sendEmail(
  client: Client,
  title: string,
  paragraph: string,
  url: string,
  departmentName: string,
  result: GrantedResult,
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

  const textFooter = `
    Com carinho,
    ${footerName ? footerName : ''}
    ${footerPhone ? `Contato: ${footerPhone}` : ''}
    ${replyEmail ? `E-mail: ${replyEmail}` : ''}
  `;

  const textBody =
    `Olá, ${client.name}!\n\n
    No acompanhamento que realizamos das publicações oficiais, identificamos uma atualização sobre o seu processo
    de outorga.\n\n
    A publicação indica ${getUserFriendlyResult(result)} do processo, e por isso já quisemos te avisar.\n\n
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

  const htmlFooterBlocks = `<p style="margin:1.5em 0 0 0;">Com carinho,</p>
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

  const html = `
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
                <p style="margin:0 0 1em 0;">No acompanhamento que realizamos das publicações oficiais, identificamos
                  uma <strong>atualização</strong> sobre o seu processo de outorga. A publicação indica
                  <strong>${getUserFriendlyResult(result)}</strong> do processo, e por isso já quisemos te avisar.</p>
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
                ${htmlFooterBlocks}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
    </body>
    </html>
    `;

  const mail: SendMailOptions = {
    from: SMTP_USER,
    to: client.email || '',
    replyTo: replyEmail,
    bcc: BCC_EMAIL?.trim() || '',
    subject: `${getUserFriendlyResult(result, true)} de outorga`,
    text: textBody,
    html: html.trim(),
  };

  const transportOptions: Transport = {
    host: SMTP_HOST || '',
    port: SMTP_PORT ? parseInt(SMTP_PORT) : 0,
    secure: true,
    auth: { user: SMTP_USER || '', pass: SMTP_PASSWORD || '' },
  };
  const smtpTransport = nodemailer.createTransport(transportOptions);
  await smtpTransport.sendMail(mail);
}

function determineGrantedResult(paragraph: string): GrantedResult {
  if (paragraph.includes('Fica outorgada')) {
    return 'granted';
  } else if (paragraph.includes('Fica revogada')) {
    return 'rejected';
  }
  return 'unknown';
}

async function main() {
  let data = null;
  const args = process.argv.slice(2);
  const iterativeMode = args.some(arg => arg === 'iterative');
  const noSendEmail = args.some(arg => arg === 'no-send-email');
  const dateParam = args.find(arg => arg.startsWith('date='))?.split('=')[1];
  const date = dateParam ? new Date(dateParam) : new Date();
  const today = date.toISOString().split('T')[0]?.replace(/-0/g, '-');

  await printSentence('\tSISTEMA DE MONITORAMENTO DE OUTORGA DO MEIO AMBIENTE\n\n', iterativeMode);
  await printSentence(`\tBUSCANDO OUTORGA DO DIA [${today}]\n\n`, iterativeMode);

  try {
    const response = await fetch(URL + today, { headers: HEADERS });
    if (!response.ok) {
      console.log(`HTTP error! status: ${response.status}`);
      return;
    }
    data = await response.json();
  } catch (error) {
    console.log('Error:', error);
    return;
  }

  if (!data) {
    console.log('No data received');
    return;
  }

  const acts = (data as { items: Act[] })?.items;
  if (!acts || acts?.length === 0 || !acts[0]?.children || acts[0]?.children?.length === 0) {
    console.log('No acts received');
    return;
  }

  const environment = acts[0]?.children.find(child => child?.name?.toLowerCase().includes('meio ambiente'));
  if (!environment || !environment?.children || environment?.children?.length === 0) {
    console.log('No environment found');
    return;
  }
  await printSentence(
    `\t[${environment?.children?.length}] DEPARTAMENTOS ENCONTRADOS NO MEIO AMBIENTE\n\n`,
    iterativeMode,
  );

  let outorgas: Outorga[] = [];
  for (const department of environment?.children || []) {
    const departmentName = department?.name;
    const children = department?.children as Child[];
    if (children && children?.length > 0) {
      for (const child of children) {
        const childPublications = child?.publications;
        if (childPublications && childPublications?.length > 0) {
          for (const publication of childPublications) {
            if (publication?.title?.toLowerCase().includes('outorga')) {
              outorgas.push({ ...publication, departmentName });
            }
          }
        }
      }
    }
    const publications = department?.publications;
    if (!publications || publications?.length === 0) {
      continue;
    }
    for (const publication of publications) {
      if (publication?.title?.toLowerCase().includes('outorga')) {
        outorgas.push({ ...publication, departmentName });
      }
    }
  }
  await printSentence(`\t[${outorgas?.length}] PUBLICAÇÕES COM OUTORGA ENCONTRADAS\n\n`, iterativeMode);

  for (const outorga of outorgas) {
    const outorgaURL = `https://do-api-web-search.doe.sp.gov.br/v2/publications/${outorga?.slug}`;
    let data: PublicationResponse | null = null;
    try {
      const response = await fetch(outorgaURL, { headers: HEADERS });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      data = await response.json();
    } catch (error) {
      console.log('Error:', error);
      return;
    }

    if (!data || !data?.content) {
      console.log('No data received');
      continue;
    }

    const outorgaContent = data?.content;
    const $ = cheerio.load(outorgaContent);
    const paragraphs = $('p')
      .map((_, element) => $(element).text())
      .get();

    for (const paragraph of paragraphs) {
      const client = CLIENTS.filter(client => client.cnpj).find(client => paragraph.includes(client.cnpj));
      if (client) {
        if (!client?.name) client.name = 'Amigo(a)';
        if (!client?.email) {
          console.error(`\tCLIENTE [${client.cnpj}] não possui e-mail cadastrado`);
          return;
        }

        const result = determineGrantedResult(paragraph);
        await printSentence(`\tRESULTADO DA OUTORGA: [${result.toUpperCase()}]\n\n`, iterativeMode);

        const webUrl = `https://doe.sp.gov.br/${outorga?.slug}`;
        await printSentence(`\tCLIENTE [${client.name}] encontrado na publicação\n\n`, iterativeMode);
        if (!noSendEmail) {
          await printSentence(`\tDISPARANDO EMAIL PARA O CLIENTE [${client.email}]\n\n`, iterativeMode);
          try {
            await sendEmail(client, outorga?.title, paragraph, webUrl, outorga?.departmentName, result);
          } catch (error) {
            console.log('Error sending email:', error);
            return;
          }
          await printSentence(`\tEMAIL ENVIADO PARA O CLIENTE [${client.email}]\n\n`, iterativeMode);
        } else {
          await printSentence(paragraph, iterativeMode);
        }
      }
    }
  }
}

main();
