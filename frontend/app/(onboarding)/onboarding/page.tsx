'use client';

import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { CompletionStep } from '@/components/onboarding/completion-step';
import { ConnectToolsStep } from '@/components/onboarding/connect-tools-step';
import { ProgressBar } from '@/components/onboarding/progress-bar';
import { UploadDocumentsStep } from '@/components/onboarding/upload-documents-step';
import { WelcomeStep } from '@/components/onboarding/welcome-step';
import { useOnboarding } from '@/hooks/use-onboarding';
import { useWorkspace } from '@/hooks/use-workspace';

const TOTAL_STEPS = 4;

export default function OnboardingPage() {
  const router = useRouter();
  const {
    onboarding,
    loading: onboardingLoading,
    error: onboardingError,
    updateStep,
    completeOnboarding,
  } = useOnboarding();
  const { workspace, loading: workspaceLoading } = useWorkspace();

  const loading = onboardingLoading || workspaceLoading;
  const currentStep = Math.min(
    TOTAL_STEPS,
    Math.max(1, onboarding?.current_step ?? 1)
  );

  const goToStep = async (step: number) => {
    await updateStep(step);
  };

  const finish = async () => {
    await completeOnboarding();
    router.push('/dashboard');
    router.refresh();
  };

  if (loading) {
    return (
      <div className="flex min-h-[360px] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
      </div>
    );
  }

  if (onboardingError || !onboarding) {
    return (
      <div className="w-full max-w-lg rounded-lg border border-red-200 bg-white p-6 text-center">
        <h1 className="text-lg font-semibold text-slate-950">Onboarding unavailable</h1>
        <p className="mt-2 text-sm text-slate-600">
          {onboardingError || 'No onboarding record was found for this workspace.'}
        </p>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="mx-auto mb-10 max-w-2xl">
        <ProgressBar currentStep={currentStep} totalSteps={TOTAL_STEPS} />
      </div>

      {currentStep === 1 && (
        <WelcomeStep
          workspaceName={workspace?.name ?? 'your workspace'}
          onNext={() => goToStep(2)}
          onSkipSetup={finish}
        />
      )}
      {currentStep === 2 && (
        <ConnectToolsStep onNext={() => goToStep(3)} onSkip={() => goToStep(3)} />
      )}
      {currentStep === 3 && (
        <UploadDocumentsStep onNext={() => goToStep(4)} onSkip={() => goToStep(4)} />
      )}
      {currentStep === 4 && <CompletionStep onComplete={finish} />}
    </div>
  );
}
