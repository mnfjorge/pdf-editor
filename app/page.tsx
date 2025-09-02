
export default function Page() {
  return (
    <main className="min-h-screen bg-gray-100">
      <div className="py-6 border-b bg-white">
        <div className="max-w-6xl mx-auto px-4">
          <h1 className="text-xl font-semibold text-gray-900">PDF Upload & Text Overlay</h1>
          <p className="text-sm text-gray-600">Upload a PDF to Vercel Blob, add text overlays, and export.</p>
        </div>
      </div>
      {/* Editor */}
      {/* @ts-expect-error Server Component type boundary */}
      <EditorWrapper />
    </main>
  );
}

function EditorWrapper() {
  // Isolated wrapper to avoid RSC boundary warnings
  const PdfEditor = require('./components/PdfEditor').default;
  return <PdfEditor />;
}
