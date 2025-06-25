import { Hono } from "hono"
import { logger } from "hono/logger"
import { cors } from "hono/cors"

interface Env {
  CLOUDFLARE_ACCOUNT_ID: string
  CLOUDFLARE_API_TOKEN: string
}

const app = new Hono<{ Bindings: Env }>()

// CORS
app.use(
  "/*",
  cors({
    origin: ["http://localhost:5173"],
    allowMethods: ["POST", "GET", "DELETE", "HEAD", "OPTIONS", "PATCH"],
    allowHeaders: [
      "Tus-Resumable",
      "Upload-Length",
      "Upload-Metadata",
      "Content-Type",
      "Authorization",
      "X-Proxy-Upload",
    ],
    exposeHeaders: [
      "Location",
      "Tus-Resumable",
      "Upload-Offset",
      "Upload-Length",
    ],
    maxAge: 86400,
    credentials: true,
  })
)

// Logger
app.use("*", logger())

// Upload endpoint
app.post("/upload-video-direct", async (c) => {
  const accountId = c.env.CLOUDFLARE_ACCOUNT_ID
  const apiToken = c.env.CLOUDFLARE_API_TOKEN

  const formData = await c.req.formData()
  const file = formData.get("file")
  if (!(file instanceof File)) {
    return c.json({ error: "Archivo no válido" }, 400)
  }

  const validTypes = ["video/mp4", "video/webm", "video/ogg"]
  if (!validTypes.includes(file.type)) {
    return c.json(
      { error: "Formato no soportado. Usa MP4, WebM o Ogg." },
      400
    )
  }

  const maxSize = 500 * 1024 * 1024
  if (file.size > maxSize) {
    return c.json(
      { error: "El archivo excede el tamaño máximo de 500 MB." },
      400
    )
  }

  const uploadForm = new FormData()
  uploadForm.append("file", file)

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${apiToken}` },
      body: uploadForm,
    }
  )
  const data = await res.json()

  if (!data.success) {
    console.error("❌ Cloudflare error:", data)
    return c.json(
      { error: data.errors?.[0]?.message || "Error al subir el video" },
      500
    )
  }

  return c.json({
    videoId: data.result.uid,
    playbackUrl: `https://iframe.videodelivery.net/${data.result.uid}`,
    thumbnail: data.result.thumbnail,
    duration: data.result.duration,
  })
})

// Delete single video
app.delete("/delete-video/:videoId", async (c) => {
  const accountId = c.env.CLOUDFLARE_ACCOUNT_ID
  const apiToken = c.env.CLOUDFLARE_API_TOKEN
  const videoId = c.req.param("videoId")

  if (!videoId) {
    return c.json({ error: "Se requiere un videoId" }, 400)
  }

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/${videoId}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiToken}` },
    }
  )

  if (!res.ok) {
    const err = await res.json()
    console.error("❌ Error al eliminar video:", err)
    return c.json(
      { error: err.errors?.[0]?.message || "Error al eliminar el video" },
      500
    )
  }

  return c.json({ success: true, message: `Video ${videoId} eliminado` }, 200)
})

// Global error + 404
app.onError((err, c) => {
  console.error("Error no controlado:", err)
  return c.text("Error interno", 500)
})

app.notFound((c) => c.text("Ruta no encontrada", 404))

// Export the Worker fetch
export default {
  fetch: app.fetch,
}
