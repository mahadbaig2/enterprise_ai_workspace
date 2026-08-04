import { Check, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

const summary = [
  'Workspace created',
  'Connect tools later in Settings',
  'Upload documents later from your dashboard',
];

export function CompletionStep({ onComplete }: { onComplete: () => void }) {
  return (
    <section className="w-full max-w-xl text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
        <CheckCircle2 className="h-9 w-9" />
      </div>
      <h1 className="mt-6 text-3xl font-bold tracking-tight text-slate-950">
        You&apos;re all set!
      </h1>
      <p className="mx-auto mt-3 max-w-md text-base leading-7 text-slate-600">
        Your workspace is ready. Head to your dashboard to start asking questions.
      </p>

      <div className="mx-auto mt-8 max-w-sm rounded-lg border border-slate-200 bg-white p-4 text-left">
        {summary.map((item) => (
          <div key={item} className="flex items-center gap-3 py-2 text-sm text-slate-700">
            <Check className="h-4 w-4 text-emerald-600" />
            <span>{item}</span>
          </div>
        ))}
      </div>

      <Button onClick={onComplete} className="mt-8 min-w-40">
        Go to Dashboard
      </Button>
    </section>
  );
}
