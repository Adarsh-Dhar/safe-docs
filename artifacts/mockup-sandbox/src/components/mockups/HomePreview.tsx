export function HomePreview() {
  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6">
      <div className="bg-white shadow-sm border border-slate-200 rounded-xl p-8 max-w-lg w-full">
        <h1 className="text-2xl font-semibold text-slate-900 mb-2">
          Frontend Preview Is Working
        </h1>
        <p className="text-slate-600 mb-4">
          This is a sample component rendered by the mockup preview server.
        </p>
        <p className="text-sm text-slate-500">
          Route: /preview/HomePreview
        </p>
      </div>
    </div>
  );
}

export default HomePreview;
