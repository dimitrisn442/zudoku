import type {
  MediaTypeObject,
  OperationsFragmentFragment,
} from "./graphql/graphql.js";
import { PlaygroundDialog } from "./playground/PlaygroundDialog.js";

function isTruthyExtension(v: unknown): boolean {
  if (v === true) return true;
  if (typeof v === "number") return v === 1;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s === "true" || s === "1" || s === "yes" || s === "y";
  }
  return false;
}

export const PlaygroundDialogWrapper = ({
  server,
  servers,
  operation,
  examples,
}: {
  server?: string;
  servers?: string[];
  operation: OperationsFragmentFragment;
  examples?: MediaTypeObject[];
}) => {
  const headers = operation.parameters
    ?.filter((p) => p.in === "header")
    .sort((a, b) => (a.required && !b.required ? -1 : 1))
    .map((p) => ({
      name: p.name,
      defaultValue:
        p.schema?.default ?? p.examples?.find((x) => x.value)?.value ?? "",
      defaultActive: p.required ?? false,
      isRequired: p.required ?? false,
      enum: p.schema?.type === "array" ? p.schema?.items?.enum : p.schema?.enum,
      type: p.schema?.type ?? "string",
    }));

  const queryParams = operation.parameters
    ?.filter((p) => p.in === "query")
    .sort((a, b) => (a.required && !b.required ? -1 : 1))
    .map((p) => ({
      name: p.name,
      defaultActive: p.required ?? false,
      isRequired: p.required ?? false,
      enum: p.schema?.type === "array" ? p.schema?.items?.enum : p.schema?.enum,
      type: p.schema?.type ?? "string",
      defaultValue: p.schema?.default,
    }));

  const pathParams = operation.parameters
    ?.filter((p) => p.in === "path")
    .map((p) => ({
      name: p.name,
      defaultValue: p.schema?.default,
    }));

  const isSigned = isTruthyExtension(
    (operation.extensions as Record<string, unknown> | undefined)?.["x-signed"],
  );

  const apiKeyHeaderName =
    headers?.find((h) => h.name.toLowerCase() === "x-mbx-apikey")?.name ??
    "X-MBX-APIKEY";

  return (
    <PlaygroundDialog
      server={server}
      servers={servers}
      method={operation.method}
      url={operation.path}
      headers={headers}
      queryParams={queryParams}
      pathParams={pathParams}
      examples={examples}
      isSigned={isSigned}
      apiKeyHeaderName={apiKeyHeaderName}
    />
  );
};
