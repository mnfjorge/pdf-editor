"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
const PdfEditor = dynamic(() => import("./components/PdfEditor"), { ssr: false });

export default function Home() {
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setError(null);
    if (!file) return;
    if (file.type !== "application/pdf") {
      setError("Please select a PDF file");
      return;
    }
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      setUploadedUrl(data.url);
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <div className="min-h-screen p-6 sm:p-10">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-2xl font-semibold mb-4">PDF Uploader & Editor</h1>
        {!uploadedUrl && (
          <div className="border rounded p-4 bg-white">
            <p className="mb-2">Select a PDF to upload to Blob storage:</p>
            <input
              type="file"
              accept="application/pdf"
              onChange={handleFileChange}
              className="block"
            />
            {isUploading && <p className="text-sm text-gray-600 mt-2">Uploading...</p>}
            {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
          </div>
        )}

        {uploadedUrl && (
          <div className="mt-6">
            <p className="text-sm text-gray-600 mb-2 break-all">Uploaded URL: {uploadedUrl}</p>
            <PdfEditor pdfUrl={uploadedUrl} />
          </div>
        )}
      </div>
    </div>
  );
}
