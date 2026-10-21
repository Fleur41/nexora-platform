"use client";

import { Download, FileText, ImageIcon, Trash2, Upload } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input, NativeSelect } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import {
  saveDocument,
  useDeleteDocument,
  useDocumentBlob,
  useDocuments,
  useUploadDocument,
} from "@/features/documents/api";
import { ApiError, errorMessage } from "@/lib/api/errors";
import { DOCUMENT_CATEGORY } from "@/lib/labels";
import { formatBytes, formatDate } from "@/lib/utils";
import type { DocumentCategory, DocumentTarget, NexoraDocument } from "@/types/api";

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = ".pdf,.docx,.jpg,.jpeg,.png,.webp";
const IMAGE_ACCEPT = ".jpg,.jpeg,.png,.webp";

interface DocumentsPanelProps {
  target: DocumentTarget;
  targetId: string;
  canManage: boolean;
  categories: DocumentCategory[];
  /** Show image documents as a thumbnail gallery. */
  gallery?: boolean;
}

export function DocumentsPanel({ target, targetId, canManage, categories, gallery }: DocumentsPanelProps) {
  const docs = useDocuments(target, targetId);
  const remove = useDeleteDocument();
  const [uploading, setUploading] = React.useState(false);
  const [removing, setRemoving] = React.useState<NexoraDocument | null>(null);

  const download = (doc: NexoraDocument) =>
    saveDocument(doc).catch((err) => toast.error(errorMessage(err)));

  const list = docs.data?.results ?? [];
  const photos = gallery ? list.filter((d) => d.category === "photo") : [];
  const files = gallery ? list.filter((d) => d.category !== "photo") : list;

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex justify-end">
          <Button variant="outline" onClick={() => setUploading(true)}>
            <Upload /> Upload
          </Button>
        </div>
      )}
      {docs.isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : docs.isError ? (
        <ErrorState message={errorMessage(docs.error)} onRetry={() => docs.refetch()} />
      ) : list.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No documents yet"
          description={
            canManage
              ? "Upload PDFs, Word documents or photos. Files are private to your organization."
              : "Nothing has been uploaded here yet."
          }
        />
      ) : (
        <>
          {photos.length > 0 && (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {photos.map((doc) => (
                <li key={doc.id} className="group relative overflow-hidden rounded-lg border bg-muted">
                  <Thumbnail doc={doc} />
                  <div className="flex items-center justify-between gap-2 p-2">
                    <p className="truncate text-xs" title={doc.title}>
                      {doc.title}
                    </p>
                    {canManage && (
                      <button
                        className="rounded p-1 text-muted-foreground hover:text-destructive"
                        onClick={() => setRemoving(doc)}
                        aria-label={`Remove ${doc.title}`}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {files.length > 0 && (
            <ul className="divide-y rounded-lg border bg-card">
              {files.map((doc) => (
                <li key={doc.id} className="flex items-center gap-3 px-4 py-3">
                  {doc.content_type.startsWith("image/") ? (
                    <ImageIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                  ) : (
                    <FileText className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{doc.title}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {DOCUMENT_CATEGORY[doc.category]} · {formatBytes(doc.size)} ·{" "}
                      {formatDate(doc.created_at)}
                      {doc.uploaded_by_name && ` · ${doc.uploaded_by_name}`}
                    </p>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => download(doc)} aria-label={`Download ${doc.title}`}>
                    <Download />
                  </Button>
                  {canManage && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive"
                      onClick={() => setRemoving(doc)}
                      aria-label={`Remove ${doc.title}`}
                    >
                      <Trash2 />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <UploadDialog
        open={uploading}
        onOpenChange={setUploading}
        target={target}
        targetId={targetId}
        categories={categories}
      />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Remove document?"
        description="It will be hidden from everyone. A record of the file is kept in the audit log."
        confirmLabel="Remove"
        destructive
        loading={remove.isPending}
        onConfirm={() =>
          removing &&
          remove.mutate(removing.id, {
            onSuccess: () => {
              toast.success("Document removed");
              setRemoving(null);
            },
            onError: (err) => toast.error(errorMessage(err)),
          })
        }
      />
    </div>
  );
}

function Thumbnail({ doc }: { doc: NexoraDocument }) {
  const blob = useDocumentBlob(doc.id);
  const url = React.useMemo(() => (blob.data ? URL.createObjectURL(blob.data) : null), [blob.data]);
  React.useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  if (!url) return <Skeleton className="aspect-[4/3] w-full rounded-none" />;
  // eslint-disable-next-line @next/next/no-img-element -- private blob URL, not optimizable
  return <img src={url} alt={doc.title} className="aspect-[4/3] w-full object-cover" />;
}

function UploadDialog({
  open,
  onOpenChange,
  target,
  targetId,
  categories,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: DocumentTarget;
  targetId: string;
  categories: DocumentCategory[];
}) {
  const upload = useUploadDocument();
  const [file, setFile] = React.useState<File | null>(null);
  const [title, setTitle] = React.useState("");
  const [category, setCategory] = React.useState<DocumentCategory>(categories[0]!);
  const [clientError, setClientError] = React.useState<string | null>(null);

  const reset = () => {
    setFile(null);
    setTitle("");
    setClientError(null);
    upload.reset();
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return setClientError("Choose a file to upload.");
    if (file.size > MAX_BYTES) return setClientError("Files must be 10 MB or smaller.");
    setClientError(null);
    upload.mutate(
      { target, targetId, file, title: title || file.name, category },
      {
        onSuccess: () => {
          toast.success("Uploaded");
          reset();
          onOpenChange(false);
        },
      },
    );
  };

  const serverError =
    upload.error instanceof ApiError
      ? (upload.error.fieldError("file") ??
        upload.error.details.non_field_errors?.[0] ??
        upload.error.message)
      : upload.error
        ? errorMessage(upload.error)
        : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload a document</DialogTitle>
          <DialogDescription>
            PDF, Word (.docx), JPEG, PNG or WebP, up to 10 MB. Files are checked on the server and
            stored privately.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="space-y-4">
          {(clientError || serverError) && <Alert variant="error" title={clientError ?? serverError!} />}
          {categories.length > 1 && (
            <FormField id="doc-category" label="Type">
              <NativeSelect value={category} onChange={(e) => setCategory(e.target.value as DocumentCategory)}>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {DOCUMENT_CATEGORY[c]}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
          )}
          <FormField id="doc-file" label="File">
            <Input
              type="file"
              accept={category === "photo" ? IMAGE_ACCEPT : ACCEPT}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </FormField>
          <FormField id="doc-title" label="Title (optional)" hint="Defaults to the file name.">
            <Input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={upload.isPending}>
              Upload
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
