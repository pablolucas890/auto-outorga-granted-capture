import { ClientOrLead } from '../types';
import fs from 'fs';

export const HEADERS = {
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
export const ENDPOINT_URL = 'https://do-api-web-search.doe.sp.gov.br/v2/summary/structured';
export const JOURNAL_ID = 'ca96256b-6ca1-407f-866e-567ef9430123';
export const SECTION_ID = '257b103f-1eb2-4f24-a170-4e553c7e4aac';
export const URL = `${ENDPOINT_URL}?JournalId=${JOURNAL_ID}&SectionId=${SECTION_ID}&Date=`;
export const CLIENTS: ClientOrLead[] =
  JSON.parse(fs.existsSync('data/clients.json') ? fs.readFileSync('data/clients.json', 'utf8') : '[]') || [];
export const SELECTED_CITIES: string[] = fs.existsSync('data/selected-cities.txt')
  ? fs.readFileSync('data/selected-cities.txt', 'utf8').split('\n')
  : [];
export const WAIT_TIME_BETWEEN_SENTENCES = 2000;
export const WAIT_TIME_BETWEEN_WORDS = 50;
export const COLOR_WHITE = '#FFFFFF';
export const COLOR_BLACK = '#000000';
export const CNPJ_REGEX = /^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/;
export const LIMIT_OF_DISPATCH_EMAILS = 5;
export const TIMEOUT_BETWEEN_MAIL_DISPATCH_IN_S = 48;
