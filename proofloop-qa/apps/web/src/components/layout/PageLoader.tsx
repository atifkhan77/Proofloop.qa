/** Suspense fallback while a lazy route chunk loads. */
export default function PageLoader() {
  return (
    <div className="flex h-full w-full items-center justify-center p-8" role="status" aria-label="Loading">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>
  );
}
