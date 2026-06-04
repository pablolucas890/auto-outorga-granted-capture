import * as cheerio from 'cheerio';
import { exec } from 'child_process';
import { ClientOrLead, PublicationResponse, Act, Child, Company, Publication } from './types';
import { determineGrantedResult, printSentence, removeAccents, sendEmail } from './utils/functions';
import {
  CLIENTS,
  CNPJ_REGEX,
  HEADERS,
  LIMIT_OF_DISPATCH_EMAILS,
  SELECTED_CITIES,
  TIMEOUT_BETWEEN_MAIL_DISPATCH_IN_S,
  URL,
} from './utils/constants';

async function main() {
  let dispatchEmailCount = 0;
  let data = null;
  let acts: Act[] = [];
  let companiesArray: Company[] = [];
  let doPublications: Publication[] = [];
  const sentEmails = new Set<string>();

  const args = process.argv.slice(2);
  const hasHelp = args.some(arg => arg === 'help');
  const iterativeMode = args.some(arg => arg === 'iterative');
  const noSendEmail = args.some(arg => arg === 'no-send-email');
  const dateParam = args.find(arg => arg.startsWith('date='))?.split('=')[1];
  const date = dateParam ? new Date(dateParam) : new Date();
  const todayDomg = date.toISOString().split('T')[0];
  const today = todayDomg?.replace(/-0/g, '-');

  if (hasHelp) {
    console.log('Usage: npm start [options]');
    console.log('Options:');
    console.log('  help     Show help');
    console.log('  iterative    Iterative mode');
    console.log('  no-send-email    No send email');
    console.log('  date=YYYY-MM-DD    Search for a specific date');
    return;
  }

  await printSentence('\tSISTEMA DE MONITORAMENTO DE PUBLICAÇÕES DO MEIO AMBIENTE\n\n', iterativeMode);
  await printSentence(`\tBUSCANDO PUBLICAÇÕES DO DIA [${today}]\n\n`, iterativeMode);

  // Get publications from DO of SP
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

  if (data) {
    acts = (data as { items: Act[] })?.items;
  }

  const environment = acts[0]?.children.find(child => child?.name?.toLowerCase().includes('meio ambiente'));

  for (const department of environment?.children || []) {
    const departmentName = department?.name;
    const children = department?.children as Child[];
    if (children && children?.length > 0) {
      for (const child of children) {
        const childPublications = child?.publications;
        if (childPublications && childPublications?.length > 0) {
          for (const publication of childPublications) {
            if (publication?.title?.toLowerCase().includes('outorga')) {
              doPublications.push({ ...publication, departmentName, state: 'SP' });
            }
          }
        }
      }
    }

    const dptPublications = department?.publications;
    if (!dptPublications || dptPublications?.length === 0) {
      continue;
    }

    for (const dptPublication of dptPublications) {
      if (dptPublication?.title?.toLowerCase().includes('outorga')) {
        doPublications.push({ ...dptPublication, departmentName, state: 'SP' });
      }
    }
  }
  await printSentence(`\t[${doPublications?.length || 0}] PUBLICAÇÕES DE OUTORGA ENCONTRADAS [SP]\n\n`, iterativeMode);

  // Get publication from DO of MG
  const domgData: string = await new Promise<string>((resolve, reject) => {
    exec(`bash ./src/domg.sh ${todayDomg}`, (error, stdout, stderr) => {
      if (error || stderr) {
        console.log(`Error executing domg.sh: ${error || stderr}`);
        resolve('');
      }
      if (stdout != null && stdout !== '') {
        resolve(stdout);
      } else {
        resolve('');
      }
    });
  });

  if (domgData) {
    await printSentence(`\t[1] PUBLICAÇÃO ENCONTRADA [MG]\n\n`, iterativeMode);
    doPublications.push({
      title: 'Publicação do Diário Oficial de MG do dia ' + todayDomg.split('-').reverse().join('/'),
      slug: 'https://www.jornalminasgerais.mg.gov.br/edicao-do-dia',
      departmentName: 'Meio Ambiente',
      state: 'MG',
      content: domgData,
    });
  }

  for (const publication of doPublications) {
    let paragraphs: string[] = [];
    const publicationUrl =
      publication.state === 'MG' ? publication.slug : `https://doe.sp.gov.br/${publication.slug}`;

    if (publication.state === 'SP') {
      const outorgaURL = `https://do-api-web-search.doe.sp.gov.br/v2/publications/${publication?.slug}`;
      let data: PublicationResponse | null = null;
      try {
        const response = await fetch(outorgaURL, { headers: HEADERS });
        if (!response.ok) {
          console.log(`HTTP error! status: ${response.status}`);
          continue;
        }
        data = await response.json();
      } catch (error) {
        console.log('Error:', error);
        continue;
      }

      if (!data || !data?.content) {
        console.log('No data received');
        continue;
      }

      const outorgaContent = data?.content;
      const $ = cheerio.load(outorgaContent);
      paragraphs = $('p')
        .map((_, element) => $(element).text())
        .get();
    } else if (publication?.content) {
      const content = publication.content;
      const processChunks = content
        .split(/(?=\*Processo\s*n[º°o]?\s*\d)/i)
        .map(chunk => chunk.trim())
        .filter(chunk => chunk.length > 0);

      if (processChunks.length > 1) {
        paragraphs = processChunks.filter(chunk =>
          removeAccents(chunk).toLowerCase().includes('outorga de direito de uso'),
        );
      } else {
        const rawParagraphs = content.split('\n') || [];
        paragraphs = [];
        for (let i = 0; i < rawParagraphs.length; i += 3) {
          const group = rawParagraphs.slice(i, i + 3).join(' ');
          const lowerCaseParagraph = removeAccents(group).toLowerCase();
          if (!lowerCaseParagraph.includes('outorga de direito de uso')) {
            continue;
          }
          paragraphs.push(group);
        }
        paragraphs = paragraphs.filter(paragraph => paragraph.trim());
      }
    }

    for (const paragraph of paragraphs) {
      for (const firstSentenceSplited of paragraph.split(' ')) {
        for (const secondeSentenceSplited of firstSentenceSplited.split(' ')) {
          const word = secondeSentenceSplited.replace(',', '').trim();
          const cnpj = word.match(CNPJ_REGEX);
          if (cnpj) {
            if (!companiesArray.find(company => company.cnpj === cnpj[0])) {
              companiesArray.push({ cnpj: cnpj[0], paragraph: paragraph, publication });
            }
          }
        }
      }
      const client = CLIENTS.filter(client => client.cnpj || client.cpf).find(
        client => paragraph.includes(client.cnpj) || paragraph.includes(client.cpf),
      );
      if (client) {
        if (!client?.name) client.name = 'Amigo(a)';
        if (!client?.email) {
          console.error(`\tCLIENTE [${client.cnpj}/${client.cpf}] não possui e-mail cadastrado`);
          continue;
        }

        const result = determineGrantedResult(paragraph, publication.state);
        await printSentence(`\tCLIENTE [${client.name}] encontrado na publicação\n\n`, iterativeMode);
        if (sentEmails.has(client.email)) {
          await printSentence(`\tEMAIL [${client.email}] já enviado, ignorando duplicata\n\n`, iterativeMode);
          continue;
        }
        if (!noSendEmail) {
          if (dispatchEmailCount >= LIMIT_OF_DISPATCH_EMAILS) {
            await printSentence(`\tLIMITE DE EMAILS DISPATCHADOS ATINGIDO\n\n`, iterativeMode);
            break;
          }
          await printSentence(
            `\tDISPARANDO EMAIL PARA O CLIENTE [${client.name}] [${client.email}]\n\n`,
            iterativeMode,
          );
          try {
            await sendEmail(
              client,
              publication?.title,
              paragraph,
              publicationUrl,
              publication?.departmentName,
              result,
              'client',
            );
            sentEmails.add(client.email);
            dispatchEmailCount++;
          } catch (error) {
            console.log('Error sending email:', error);
            continue;
          }
        }
      }
    }
  }

  for (const company of companiesArray) {
    const getDataFromCnpjOrCpfUrl = 'https://www.procuroacho.com';
    const searchUrl = getDataFromCnpjOrCpfUrl + '/company-search?q=';
    let data: string | null = null;
    try {
      const response = await fetch(searchUrl + company.cnpj, { method: 'GET', headers: HEADERS });
      if (!response.ok) {
        continue;
      }
      data = await response.text();

      const $ = cheerio.load(data);
      const anchors = $('a');

      for (const anchor of anchors) {
        const href = anchor.attribs.href;
        const companyUrl = getDataFromCnpjOrCpfUrl + href;
        let content: string | null = null;
        try {
          const response = await fetch(companyUrl, { method: 'GET', headers: HEADERS });
          if (!response.ok) {
            continue;
          }
          content = await response.text();
        } catch (error) {
          continue;
        }
        const $ = cheerio.load(content);
        const email = $('span[itemprop="email"]').text();
        const legalName = $('span[itemprop="legalName"]').text();
        const addressLocality = $('span[itemprop="addressLocality"]').text();
        const addressRegion = $('span[itemprop="addressRegion"]').text();
        const localityNorm = removeAccents(addressLocality ?? '').toLowerCase();
        const isSelectedCity = SELECTED_CITIES.some(city => localityNorm === removeAccents(city).toLowerCase());
        const isClient = CLIENTS.find(client => client.cnpj === company.cnpj || client.email === email);

        if (email && legalName && !isClient && localityNorm && isSelectedCity) {
          if (sentEmails.has(email)) {
            continue;
          }
          const grantedResult = determineGrantedResult(company.paragraph, company.publication.state);
          const lead: ClientOrLead = { name: legalName, cnpj: company.cnpj, cpf: '', email: email };
          const companyPublicationUrl =
            company.publication.state === 'MG'
              ? company.publication.slug
              : `https://doe.sp.gov.br/${company.publication.slug}`;
          if (!noSendEmail) {
            if (dispatchEmailCount >= LIMIT_OF_DISPATCH_EMAILS) {
              await printSentence(`\tLIMITE DE EMAILS DISPATCHADOS ATINGIDO\n\n`, iterativeMode);
              break;
            }
            await printSentence(
              `\tDISPARANDO EMAIL PARA A EMPRESA [${legalName}] [${email}] [${addressLocality}] [${addressRegion}]\n\n`,
              iterativeMode,
            );
            await sendEmail(
              lead,
              company.publication.title,
              company.paragraph,
              companyPublicationUrl,
              company.publication.departmentName,
              grantedResult,
              'lead',
            );
            sentEmails.add(email);
            dispatchEmailCount++;
            await new Promise(resolve => setTimeout(resolve, TIMEOUT_BETWEEN_MAIL_DISPATCH_IN_S * 1000));
          } else {
            await printSentence(
              `\tLEAD ENCONTRADO PARA A EMPRESA [${legalName}] [${email}] [${addressLocality}] [${addressRegion}]\n\n`,
              iterativeMode,
            );
          }
        }
      }
    } catch (error) {
      continue;
    }
  }
}

main();
