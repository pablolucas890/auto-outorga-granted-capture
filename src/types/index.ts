export type GrantedResult = 'granted' | 'rejected' | 'unknown';
export type EmailType = 'client' | 'lead';

export interface Company {
  cnpj: string;
  paragraph: string;
  publication: Publication;
}

export interface ClientOrLead {
  name: string;
  cnpj: string;
  cpf: string;
  email: string | null;
}

export interface Publication {
  title: string;
  slug: string;
  departmentName: string;
  isOutorga: boolean;
  content?: string;
}

export interface PublicationResponse {
  content: string;
}

export interface Act {
  name: string;
  children: Child[];
}

export interface Child {
  name: string;
  children: Child[];
  publications: Publication[];
}

export interface Transport {
  host: string;
  port: number;
  secure: boolean;
  logger?: boolean;
  debug?: boolean;
  name?: string;
  from?: string;
  auth: {
    user: string;
    pass: string;
  };
}
