import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';

const integrations = [
  {
    initials: 'GD',
    name: 'Google Drive',
    description: 'Search and retrieve files from your Drive',
    color: 'bg-emerald-100 text-emerald-700',
  },
  {
    initials: 'NO',
    name: 'Notion',
    description: 'Access your pages and databases',
    color: 'bg-slate-100 text-slate-800',
  },
  {
    initials: 'JI',
    name: 'Jira',
    description: 'Retrieve and manage your issues',
    color: 'bg-blue-100 text-blue-700',
  },
  {
    initials: 'GM',
    name: 'Gmail',
    description: 'Draft and send emails from the AI chat',
    color: 'bg-red-100 text-red-700',
  },
];

export function ConnectToolsStep({
  onNext,
  onSkip,
}: {
  onNext: () => void;
  onSkip: () => void;
}) {
  const { toast } = useToast();

  const showComingSoon = () => {
    toast({
      title: 'Coming in the next step',
      description: 'Finish setup first!',
    });
  };

  return (
    <section className="w-full max-w-3xl">
      <div className="text-center">
        <h1 className="text-3xl font-bold tracking-tight text-slate-950">
          Connect your tools
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-base leading-7 text-slate-600">
          Connect the apps your team uses. You can always add more later in Settings.
        </p>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {integrations.map((integration) => (
          <div
            key={integration.name}
            className="rounded-lg border border-slate-200 bg-white p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <div
                className={`flex h-11 w-11 items-center justify-center rounded-md text-sm font-bold ${integration.color}`}
              >
                {integration.initials}
              </div>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500">
                Not connected
              </span>
            </div>
            <h2 className="mt-4 text-base font-semibold text-slate-950">
              {integration.name}
            </h2>
            <p className="mt-1 text-sm text-slate-600">{integration.description}</p>
            <Button
              variant="outline"
              onClick={showComingSoon}
              className="mt-5 w-full"
            >
              Connect
            </Button>
          </div>
        ))}
      </div>

      <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
        <Button onClick={onNext} className="min-w-32">
          Continue
        </Button>
        <button
          type="button"
          onClick={onSkip}
          className="text-sm text-slate-500 underline-offset-4 hover:text-slate-950 hover:underline"
        >
          Skip for now
        </button>
      </div>
    </section>
  );
}
