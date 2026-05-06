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
              doPublications.push({ ...publication, departmentName, isOutorga: true });
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
        doPublications.push({ ...dptPublication, departmentName, isOutorga: true });
      }
    }
  }
  await printSentence(`\t[${doPublications?.length || 0}] PUBLICAÇÕES DE OUTORGA ENCONTRADAS [SP]\n\n`, iterativeMode);

  // Get publication from DO of MG
  const domgData: string | null = await new Promise<string>((resolve, reject) => {
    exec(`bash ./src/domg.sh ${todayDomg}`, (error, stdout, stderr) => {
      if (error) {
        console.log(`Error executing domg.sh: ${error}`);
        reject(null);
      }
      resolve(stdout);
    });
  });

  if (domgData) {
    await printSentence(`\t[1] PUBLICAÇÃO ENCONTRADA [MG]\n\n`, iterativeMode);
    doPublications.push({
      title: 'Publicação do Diário Oficial de MG do dia ' + todayDomg.split('-').reverse().join('/'),
      slug: 'https://www.jornalminasgerais.mg.gov.br/edicao-do-dia',
      departmentName: 'Meio Ambiente',
      isOutorga: false,
      content: domgData,
    });
  }

  for (const publication of doPublications) {
    let paragraphs: string[] = [];
    if (publication?.isOutorga) {
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
      const rawParagraphs = publication?.content?.split('\n') || [];
      paragraphs = [];
      for (let i = 0; i < rawParagraphs.length; i += 3) {
        const group = rawParagraphs.slice(i, i + 3).join(' ');
        paragraphs.push(group);
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

        const result = determineGrantedResult(paragraph);
        const webUrl = `https://doe.sp.gov.br/${publication?.slug}`;
        await printSentence(`\tCLIENTE [${client.name}] encontrado na publicação\n\n`, iterativeMode);
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
              webUrl,
              publication?.departmentName,
              result,
              'client',
              publication?.isOutorga,
            );
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
        const localityNorm = removeAccents(addressLocality ?? '').toLowerCase();
        const isSelectedCity = SELECTED_CITIES.some(city => localityNorm === removeAccents(city).toLowerCase());
        const isClient = CLIENTS.find(client => client.cnpj === company.cnpj || client.email === email);

        if (email && legalName && !isClient && localityNorm && isSelectedCity) {
          const grantedResult = determineGrantedResult(company.paragraph);
          const lead: ClientOrLead = { name: legalName, cnpj: company.cnpj, cpf: '', email: email };
          if (!noSendEmail) {
            if (dispatchEmailCount >= LIMIT_OF_DISPATCH_EMAILS) {
              await printSentence(`\tLIMITE DE EMAILS DISPATCHADOS ATINGIDO\n\n`, iterativeMode);
              break;
            }
            await printSentence(
              `\tDISPARANDO EMAIL PARA A EMPRESA [${legalName}] [${email}] [${addressLocality}]\n\n`,
              iterativeMode,
            );
            await sendEmail(
              lead,
              company.publication.title,
              company.paragraph,
              company.publication.slug,
              company.publication.departmentName,
              grantedResult,
              'lead',
              company.publication.isOutorga,
            );
            dispatchEmailCount++;
            await new Promise(resolve => setTimeout(resolve, TIMEOUT_BETWEEN_MAIL_DISPATCH_IN_S * 1000));
          } else {
            await printSentence(
              `\tLEAD ENCONTRADO PARA A EMPRESA [${legalName}] [${email}] [${addressLocality}]\n\n`,
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
