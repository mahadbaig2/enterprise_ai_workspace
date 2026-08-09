import { Bot, FileSearch, TicketCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';

const features = [
  {
    icon: FileSearch,
    text: 'Search across your Google Drive, Notion, and Jira with AI',
  },
  {
    icon: Bot,
    text: "Ask questions and get cited answers from your company's documents",
  },
  {
    icon: TicketCheck,
    text: 'Retrieve, create, and update Jira tasks without leaving this tab',
  },
];

export function WelcomeStep({
  workspaceName,
  onNext,
}: {
  workspaceName: string;
  onNext: () => void;
}) {
  return (
    <section className="w-full max-w-2xl text-center">
      <h1 className="text-4xl font-bold tracking-tight text-slate-950">
        Welcome to {workspaceName}
      </h1>
      <p className="mx-auto mt-4 max-w-xl text-base leading-7 text-slate-600">
        Your AI workspace is ready. Connect the required enterprise systems to complete setup.
      </p>

      <div className="mt-8 grid gap-3 text-left">
        {features.map((feature) => {
          const Icon = feature.icon;

          return (
            <div
              key={feature.text}
              className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-4"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-slate-950 text-white">
                <Icon className="h-5 w-5" />
              </div>
              <p className="text-sm text-slate-700">{feature.text}</p>
            </div>
          );
        })}
      </div>

      <div className="mt-8 flex flex-col items-center gap-3">
        <Button onClick={onNext} className="min-w-40">
          Get Started
        </Button>
      </div>
    </section>
  );
}
