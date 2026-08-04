'use client';

import { ChangeEvent, useRef, useState } from 'react';
import { FileUp, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function UploadDocumentsStep({
  onNext,
  onSkip,
}: {
  onNext: () => void;
  onSkip: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [files, setFiles] = useState<File[]>([]);

  const addFiles = (selectedFiles: FileList | null) => {
    if (!selectedFiles) return;
    setFiles((current) => [...current, ...Array.from(selectedFiles)]);
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    addFiles(event.target.files);
    event.target.value = '';
  };

  const removeFile = (index: number) => {
    setFiles((current) => current.filter((_, fileIndex) => fileIndex !== index));
  };

  return (
    <section className="w-full max-w-2xl">
      <div className="text-center">
        <h1 className="text-3xl font-bold tracking-tight text-slate-950">
          Upload your documents
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-base leading-7 text-slate-600">
          Upload policies, handbooks, or any documents you want the AI to reference.
          PDFs and images supported.
        </p>
      </div>

      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          addFiles(event.dataTransfer.files);
        }}
        className="mt-8 rounded-xl border-2 border-dashed border-slate-300 bg-white p-8 text-center transition-colors hover:border-slate-500"
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          accept=".pdf,.docx,.pptx,.png,.jpg,.jpeg"
          onChange={handleFileChange}
        />
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-700">
          <FileUp className="h-6 w-6" />
        </div>
        <p className="mt-4 text-sm font-medium text-slate-950">
          Drag &amp; drop files here, or click to browse
        </p>
        <p className="mt-2 text-xs text-slate-500">
          PDF, DOCX, PPTX, PNG, JPG - max 20MB each
        </p>
      </div>

      {files.length > 0 && (
        <div className="mt-4 rounded-lg border border-slate-200 bg-white">
          {files.map((file, index) => (
            <div
              key={`${file.name}-${index}`}
              className="flex items-center gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0"
            >
              <span className="min-w-0 flex-1 truncate text-sm text-slate-700">
                {file.name}
              </span>
              <button
                type="button"
                onClick={() => removeFile(index)}
                className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                aria-label={`Remove ${file.name}`}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <p className="mt-4 text-center text-sm text-slate-500">
        You can upload more documents anytime from your dashboard.
      </p>

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
