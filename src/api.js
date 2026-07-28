// Thin wrappers over the Express contract. Frontend hits same-origin /api;
// the Vite proxy forwards to :3001, so no host/port ever appears here.

async function json(res) {
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

export async function loadDraft(date) {
  const { body } = await json(await fetch(`/api/draft/${date}`));
  return body.markdown ?? "";
}

export async function saveDraft(date, markdown) {
  await fetch(`/api/draft/${date}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ markdown }),
  });
}

export async function finalize(date) {
  return json(
    await fetch(`/api/finalize/${date}`, { method: "POST" })
  );
}

export async function loadDay(date) {
  const { body } = await json(await fetch(`/api/day/${date}`));
  return body.entries ?? [];
}

export async function loadResources(date) {
  const { body } = await json(await fetch(`/api/resources/${date}`));
  return body.resources ?? [];
}

export async function deleteResource(date, name) {
  return json(
    await fetch(`/api/resource/${date}/${encodeURIComponent(name)}`, {
      method: "DELETE",
    })
  );
}

// Read a File -> data URL, POST it, return the served /files URL.
export async function uploadImage(date, file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
  const ext = (
    file.name?.split(".").pop() ||
    file.type.split("/")[1] ||
    "png"
  ).toLowerCase();
  const res = await fetch(`/api/resource/${date}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dataUrl, ext }),
  });
  const { body } = await json(res);
  if (!body.ok) throw new Error(body.error || "upload failed");
  return body.url;
}
