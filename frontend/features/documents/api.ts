import { useMutation, useQuery } from "@tanstack/react-query";

import { api, apiDownload } from "@/lib/api/client";
import { useInvalidateOrg, useOrgKey } from "@/lib/org-query";
import type { DocumentCategory, DocumentTarget, NexoraDocument, Paginated } from "@/types/api";

export function useDocuments(target: DocumentTarget, targetId: string, category?: DocumentCategory) {
  const key = useOrgKey();
  return useQuery({
    queryKey: key("documents", target, targetId, category),
    queryFn: () =>
      api.get<Paginated<NexoraDocument>>("/documents/", {
        [target]: targetId,
        category,
        page_size: 100,
      }),
  });
}

export function useUploadDocument() {
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: (input: {
      target: DocumentTarget;
      targetId: string;
      file: File;
      title: string;
      category: DocumentCategory;
    }) => {
      const form = new FormData();
      form.append("file", input.file);
      form.append("title", input.title);
      form.append("category", input.category);
      form.append(input.target, input.targetId);
      return api.upload<NexoraDocument>("/documents/", form);
    },
    onSuccess: () => invalidate("documents"),
  });
}

export function useDeleteDocument() {
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/documents/${id}/`),
    onSuccess: () => invalidate("documents"),
  });
}

/** Image bytes for an inline photo, as an object URL (revoked by the caller's effect). */
export function useDocumentBlob(id: string, inline = true) {
  const key = useOrgKey();
  return useQuery({
    queryKey: key("documents", "blob", id),
    queryFn: () => apiDownload(`/documents/${id}/download/${inline ? "?inline=1" : ""}`),
    staleTime: 5 * 60_000,
  });
}

export async function saveDocument(doc: NexoraDocument): Promise<void> {
  const blob = await apiDownload(`/documents/${doc.id}/download/`);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = doc.original_filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
