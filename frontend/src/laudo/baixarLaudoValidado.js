export async function baixarLaudoValidado(api, id) {
  let response;
  try { response = await api.get(`/analyses/${encodeURIComponent(id)}/pdf`, { responseType: "blob" }); }
  catch (error) {
    let data = error.response?.data;
    if (data instanceof Blob) { try { data = JSON.parse(await data.text()); } catch { data = null; } }
    const failure = new Error(data?.error || "Não foi possível emitir o relatório validado. Tente novamente.");
    failure.coerencia = data?.coerencia;
    throw failure;
  }
  const blob = response.data;
  if (!(blob instanceof Blob) || blob.size === 0 || !(await blob.slice(0, 5).text()).startsWith("%PDF-")) {
    throw new Error("O servidor não retornou um PDF válido.");
  }
  return { url: URL.createObjectURL(blob), filename: `Laudo_ForenseDoc_${String(id).replace(/[^a-zA-Z0-9_-]/g, "_")}.pdf`, sizeKB: (blob.size / 1024).toFixed(1) };
}
