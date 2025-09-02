import { NextRequest } from "next/server";
import { put } from "@vercel/blob";

export const runtime = "edge";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || typeof file === "string") {
      return new Response(JSON.stringify({ error: "No file provided" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    // Ensure it's a PDF
    const contentType = (file as File).type || "application/octet-stream";
    if (!contentType.includes("pdf")) {
      return new Response(JSON.stringify({ error: "Only PDF files are allowed" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    const blob = await put((file as File).name || "upload.pdf", file as File, {
      access: "public",
      contentType,
      addRandomSuffix: true,
    });

    return new Response(JSON.stringify({ url: blob.url }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: "Upload failed" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}

