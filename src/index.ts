import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { config } from "dotenv";
import { readFileSync } from "fs";

config();
const app = new Hono();

const cert = readFileSync("./certs/localhost-cert.pem");
const key = readFileSync("./certs/localhost-key.pem");

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;

// Validate environment variables
if (!process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.CLOUDFLARE_API_TOKEN) {
    console.error("❌ Faltan variables de entorno CLOUDFLARE_ACCOUNT_ID o CLOUDFLARE_API_TOKEN");
    process.exit(1);
}

// Configure CORS
app.use('/*', cors({
    origin: ['http://localhost:5173'],
    allowMethods: ['POST', 'GET', 'DELETE', 'HEAD', 'OPTIONS', 'PATCH'],
    allowHeaders: [
        'Tus-Resumable',
        'Upload-Length',
        'Upload-Metadata',
        'Content-Type',
        'Authorization',
        'X-Proxy-Upload'
    ],
    exposeHeaders: [
        'Location',
        'Tus-Resumable',
        'Upload-Offset',
        'Upload-Length'
    ],
    maxAge: 86400,
    credentials: true
}));

// Add logger after CORS
app.use('*', logger());

// Upload video endpoint
app.post("/upload-video-direct", async (c) => {
    try {
      const formData = await c.req.formData();
      const file = formData.get("file");
  
      if (!(file instanceof File)) {
        return c.json({ error: "Archivo no válido" }, 400);
      }
  
      console.log("📦 Recibido archivo:", {
        name: file.name,
        size: file.size,
        type: file.type,
      });
  
      // Validate file type and size
      const validTypes = ["video/mp4", "video/webm", "video/ogg"];
      if (!validTypes.includes(file.type)) {
        return c.json({ error: "Formato no soportado. Usa MP4, WebM o Ogg." }, 400);
      }
  
      const maxSize = 500 * 1024 * 1024;
      if (file.size > maxSize) {
        return c.json({ error: "El archivo excede el tamaño máximo de 500 MB." }, 400);
      }
  
      const uploadForm = new FormData();
      uploadForm.append("file", file);
  
      const res = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiToken}`,
          },
          body: uploadForm,
        }
      );
  
      const data = await res.json();
      if (!data.success) {
        console.error("❌ Cloudflare error:", JSON.stringify(data, null, 2));
        return c.json({ error: data.errors[0]?.message || "Error al subir el video" }, 500);
      }
  
      return c.json({
        videoId: data.result.uid,
        playbackUrl: `https://iframe.videodelivery.net/${data.result.uid}`,
        thumbnail: data.result.thumbnail,
        duration: data.result.duration,
      });
    } catch (err) {
      console.error("❌ Error en /upload-video-direct:", err);
      return c.json({ error: "Error interno al procesar el archivo" }, 500);
    }
});

// New endpoint to delete a specific video by videoId
app.delete("/delete-video/:videoId", async (c) => {
    try {
        const videoId = c.req.param("videoId");
        if (!videoId) {
            return c.json({ error: "Se requiere un videoId" }, 400);
        }

        console.log(`🗑️ Intentando eliminar video: ${videoId}`);

        const res = await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/${videoId}`,
            {
                method: "DELETE",
                headers: {
                    Authorization: `Bearer ${apiToken}`,
                },
            }
        );

        if (!res.ok) {
            const errorData = await res.json();
            console.error("❌ Error al eliminar video:", JSON.stringify(errorData, null, 2));
            return c.json({ error: errorData.errors[0]?.message || "Error al eliminar el video" }, 500);
        }

        console.log(`✅ Video ${videoId} eliminado con éxito`);
        return c.json({ success: true, message: `Video ${videoId} eliminado` }, 200);
    } catch (err) {
        console.error("❌ Error en /delete-video:", err);
        return c.json({ error: "Error interno al eliminar el video" }, 500);
    }
});

// Function to delete all videos on startup
const deleteAllVideosOnStartup = async () => {
    try {
        console.log('\n=== Inicio limpieza de videos ===');

        const res = await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream`,
            { headers: { Authorization: `Bearer ${apiToken}` } }
        );

        const data = await res.json();
        console.log('Respuesta lista de videos:', { status: res.status, data });

        if (!data.success) {
            console.error('Error obteniendo videos:', data.errors);
            return;
        }

        const videos = data.result || [];
        console.log(`Videos encontrados: ${videos.length}`);

        for (const video of videos) {
            const delRes = await fetch(
                `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/${video.uid}`,
                { method: "DELETE", headers: { Authorization: `Bearer ${apiToken}` } }
            );

            console.log(`Eliminación video ${video.uid}:`, delRes.status);
            if (!delRes.ok) console.error('Detalles error:', await delRes.text());
        }

    } catch (error) {
        console.error('Error en limpieza inicial:', error);
    }
};

// Run cleanup on startup
//await deleteAllVideosOnStartup();

// Global error handler
app.onError((err, c) => {
    console.error('Error no controlado:', err);
    return c.text('Error interno', 500);
});

// Custom 404 handler
app.notFound((c) => {
    return c.text('Ruta no encontrada', 404);
});

// Start server
Bun.serve({
    fetch: app.fetch,
    port: 3009,
});

console.log("🚀 Servidor iniciado en http://localhost:3009");