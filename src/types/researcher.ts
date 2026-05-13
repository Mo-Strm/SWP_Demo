export interface Researcher {
  id: string;
  name: string;
  institution: string;
  country?: string;
  lat: number;
  lon: number;
  worksCount: number;
  citedByCount: number;
  hIndex?: number;
  topics: string[];
  openalexUrl: string;
  homepage?: string;
  orcid?: string;
}
