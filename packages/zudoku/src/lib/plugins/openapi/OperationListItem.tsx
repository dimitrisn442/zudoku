import { useState } from "react";
import { Badge } from "zudoku/ui/Badge.js";
import { Frame, FramePanel } from "zudoku/ui/Frame.js";
import { Separator } from "zudoku/ui/Separator.js";
import { Heading } from "../../components/Heading.js";
import { Markdown } from "../../components/Markdown.js";
import { PagefindSearchMeta } from "../../components/PagefindSearchMeta.js";
import { cn } from "../../util/cn.js";
import { groupBy } from "../../util/groupBy.js";
import { renderIf } from "../../util/renderIf.js";
import { ResponseContent } from "./components/ResponseContent.js";
import { SelectOnClick } from "./components/SelectOnClick.js";
import { useOasConfig } from "./context.js";
import { type FragmentType, useFragment } from "./graphql/index.js";
import { MCPEndpoint } from "./MCPEndpoint.js";
import { OperationsFragment } from "./OperationList.js";
import { ParameterList } from "./ParameterList.js";
import { Sidecar } from "./Sidecar.js";
import { SchemaView } from "./schema/SchemaView.js";
import { methodForColor } from "./util/methodToColor.js";

const PARAM_GROUPS = ["path", "header", "query", "cookie"] as const;
export type ParameterGroup = (typeof PARAM_GROUPS)[number];

const isTruthy = (value: unknown) => {
  if (value === true) return true;
  if (typeof value === "string") {
    const s = value.trim().toLowerCase();
    return s === "true" || s === "1" || s === "yes";
  }
  if (typeof value === "number") return value !== 0;
  return false;
};

const normalizeNotes = (value: unknown): string[] => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((v) => (typeof v === "string" ? v.trim() : ""))
      .filter(Boolean);
  }
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  return [];
};

const stripMarkdownBold = (value: unknown) => {
  if (value == null) return "";
  return String(value)
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .trim();
};

const NotesFooter = ({ notes }: { notes: string[] }) => {
  if (notes.length === 0) return null;
  return (
    <div className="text-sm text-muted-foreground">
      <ul className="list-disc ps-5 space-y-1">
        {notes.map((n, idx) => (
          <li key={idx}>
            <Markdown className="max-w-none" content={n} />
          </li>
        ))}
      </ul>
    </div>
  );
};

export const OperationListItem = ({
  operationFragment,
  globalSelectedServer,
  shouldLazyHighlight,
}: {
  operationFragment: FragmentType<typeof OperationsFragment>;
  globalSelectedServer?: string;
  shouldLazyHighlight?: boolean;
}) => {
  const operation = useFragment(OperationsFragment, operationFragment);
  const groupedParameters = groupBy(
    operation.parameters ?? [],
    (param) => param.in,
  );
  const { options } = useOasConfig();

  // Manual server selection takes precedence over the server hierarchy.
  // If no manual selection, fall back to operation's first server (already respects operation > path > global hierarchy)
  const displayServerUrl = globalSelectedServer || operation.servers.at(0)?.url;

  const first = operation.responses.at(0);
  const [selectedResponse, setSelectedResponse] = useState(first?.statusCode);
  const isMCPEndpoint = operation.extensions?.["x-mcp-server"] !== undefined;

  const requestWeight = stripMarkdownBold(
    operation.extensions?.["x-ip-weight"],
  );
  const isSigned = isTruthy(operation.extensions?.["x-signed"]);
  const parameterNotes = normalizeNotes(
    operation.extensions?.["x-parameters-notes"],
  );
  const responseNotes = normalizeNotes(
    operation.extensions?.["x-response-notes"],
  );

  const hasRequestBodySchema =
    operation.requestBody?.content?.at(0)?.schema !== undefined;

  const notesParamGroup: ParameterGroup | null = (() => {
    if (hasRequestBodySchema) return null;
    if (parameterNotes.length === 0) return null;
    const priority: ParameterGroup[] = ["query", "path", "cookie", "header"];
    return (
      priority.find((g) => (groupedParameters[g]?.length ?? 0) > 0) ?? null
    );
  })();

  return (
    <div>
      {operation.deprecated && (
        <Badge variant="muted" className="text-xs mb-4">
          deprecated
        </Badge>
      )}
      <div
        key={operation.operationId}
        className={cn(
          "grid grid-cols-1 lg:grid-cols-[minmax(0,4fr)_minmax(0,3fr)] gap-x-8 gap-y-4 items-start",
          operation.deprecated && "opacity-50 transition hover:opacity-100",
        )}
      >
        <Heading
          level={2}
          id={operation.slug}
          registerNavigationAnchor
          className="break-all col-span-full"
        >
          {operation.summary}
        </Heading>

        {operation.description && (
          <div className="col-span-full -mt-1">
            <Markdown
              className="max-w-full prose-img:max-w-prose text-muted-foreground"
              content={operation.description}
            />
          </div>
        )}

        {!isMCPEndpoint && (
          <Frame className="col-span-full">
            <FramePanel className="space-y-3">
              <div className="flex items-center gap-3 flex-wrap">
                <span
                  className={cn(
                    "inline-flex items-center rounded-md px-2.5 py-1 text-xs font-semibold border",
                    methodForColor(operation.method),
                  )}
                >
                  {operation.method.toUpperCase()}
                </span>

                <SelectOnClick className="min-w-0 flex-1 cursor-pointer">
                  <div className="font-mono text-base sm:text-lg text-foreground truncate">
                    {operation.path}
                  </div>
                </SelectOnClick>
              </div>

              {displayServerUrl ? (
                <div className="text-xs font-mono text-muted-foreground truncate">
                  {displayServerUrl.replace(/\/$/, "")}
                </div>
              ) : null}

              {(requestWeight ||
                operation.extensions?.["x-security-type"] ||
                isSigned) && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {requestWeight ? (
                    <div className="inline-flex items-center gap-2 rounded-full border bg-muted/50 px-3 py-1 text-xs text-muted-foreground">
                      <span>Request Weight</span>
                      <span className="font-mono font-semibold text-foreground">
                        {requestWeight}
                      </span>
                    </div>
                  ) : null}

                  {operation.extensions?.["x-security-type"] ? (
                    <div className="inline-flex items-center gap-2 rounded-full border bg-muted/50 px-3 py-1 text-xs text-muted-foreground">
                      <span>Security Type</span>
                      <span className="font-mono font-semibold text-foreground">
                        {String(operation.extensions["x-security-type"])}
                      </span>
                    </div>
                  ) : null}

                  {isSigned ? (
                    <div className="inline-flex items-center gap-2 rounded-full border bg-muted/50 px-3 py-1 text-xs text-muted-foreground">
                      <span>Auth</span>
                      <span className="font-mono font-semibold text-foreground">
                        Required
                      </span>
                    </div>
                  ) : null}
                </div>
              )}
            </FramePanel>
          </Frame>
        )}

        {isMCPEndpoint ? (
          <div className="col-span-full">
            <MCPEndpoint
              serverUrl={displayServerUrl}
              summary={operation.summary ?? undefined}
              data={operation.extensions?.["x-mcp-server"]}
            />
          </div>
        ) : (
          <div
            className={cn(
              "flex flex-col gap-4",
              options?.disableSidecar && "col-span-full",
            )}
          >
            {isSigned ? (
              <div className="flex flex-col gap-3">
                <Heading level={3} id={`${operation.slug}/authorization`}>
                  {operation.summary && (
                    <PagefindSearchMeta>
                      {operation.summary} &rsaquo;{" "}
                    </PagefindSearchMeta>
                  )}
                  Authorization
                </Heading>
                <Frame>
                  <FramePanel className="text-sm text-muted-foreground">
                    This is a signed endpoint and requires a signature. You can
                    check how to generate a signature in the Authentication
                    section.
                  </FramePanel>
                </Frame>
              </div>
            ) : null}
            {operation.parameters &&
              operation.parameters.length > 0 &&
              PARAM_GROUPS.flatMap((group) =>
                groupedParameters[group]?.length ? (
                  <ParameterList
                    key={group}
                    summary={operation.summary ?? undefined}
                    id={operation.slug}
                    parameters={groupedParameters[group]}
                    group={group}
                    footer={
                      notesParamGroup === group ? (
                        <NotesFooter notes={parameterNotes} />
                      ) : undefined
                    }
                  />
                ) : (
                  []
                ),
              )}
            {renderIf(operation.requestBody?.content?.at(0)?.schema, () => (
              <Separator className="my-4" />
            ))}
            {renderIf(
              operation.requestBody?.content?.at(0)?.schema,
              (schema) => (
                <div className="flex flex-col gap-4">
                  <Heading
                    level={3}
                    className="capitalize flex items-center gap-2"
                    id={`${operation.slug}/request-body`}
                  >
                    {operation.summary && (
                      <PagefindSearchMeta>
                        {operation.summary} &rsaquo;{" "}
                      </PagefindSearchMeta>
                    )}
                    Request Body{" "}
                    {operation.requestBody?.required === false ? (
                      <Badge variant="muted">optional</Badge>
                    ) : (
                      ""
                    )}
                  </Heading>
                  <SchemaView
                    schema={schema}
                    footer={
                      hasRequestBodySchema ? (
                        <NotesFooter notes={parameterNotes} />
                      ) : undefined
                    }
                  />
                </div>
              ),
            )}
            <Separator className="my-4" />
            {operation.responses.length > 0 && (
              <>
                <Heading level={3} id={`${operation.slug}/responses`}>
                  {operation.summary && (
                    <PagefindSearchMeta>
                      {operation.summary} &rsaquo;{" "}
                    </PagefindSearchMeta>
                  )}
                  Responses
                </Heading>
                <ResponseContent
                  responses={operation.responses}
                  selectedResponse={selectedResponse}
                  onSelectResponse={setSelectedResponse}
                  schemaFooter={<NotesFooter notes={responseNotes} />}
                />
              </>
            )}
          </div>
        )}

        {renderIf(!options?.disableSidecar && !isMCPEndpoint, () => (
          <Sidecar
            selectedResponse={selectedResponse}
            operation={operation}
            globalSelectedServer={globalSelectedServer}
            shouldLazyHighlight={shouldLazyHighlight}
          />
        ))}
      </div>
    </div>
  );
};
