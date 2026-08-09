import { Cloud, FileText, TicketCheck } from 'lucide-react';

export const integrationCards = [
  {
    provider: 'google_drive',
    initials: 'GD',
    name: 'Google Drive',
    description: 'Search and retrieve files from your Drive',
    color: 'bg-emerald-100 text-emerald-700',
    darkColor: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300',
    icon: Cloud,
  },
  {
    provider: 'notion',
    initials: 'NO',
    name: 'Notion',
    description: 'Access your pages and databases',
    color: 'bg-slate-100 text-slate-800',
    darkColor: 'border-slate-700 bg-slate-950 text-slate-300',
    icon: FileText,
  },
  {
    provider: 'jira',
    initials: 'JI',
    name: 'Jira',
    description: 'Retrieve and manage your issues',
    color: 'bg-blue-100 text-blue-700',
    darkColor: 'border-blue-500/20 bg-blue-500/10 text-blue-300',
    icon: TicketCheck,
  },
] as const;

export type IntegrationProvider = (typeof integrationCards)[number]['provider'];

export const requiredIntegrationProviders = integrationCards.map(
  (integration) => integration.provider
);

export function getIntegrationMeta(provider: string) {
  return integrationCards.find((integration) => integration.provider === provider);
}
