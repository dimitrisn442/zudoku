import { useEffect, useMemo, useState, useTransition } from "react";
import { useSearchParams } from "react-router";
import { useZudoku } from "zudoku/hooks";
import { Badge } from "zudoku/ui/Badge.js";
import { NativeSelect, NativeSelectOption } from "zudoku/ui/NativeSelect.js";
import { SyntaxHighlight } from "zudoku/ui/SyntaxHighlight.js";
import { useAuthState } from "../../authentication/state.js";
import { PathRenderer } from "../../components/PathRenderer.js";
import { cn } from "../../util/cn.js";
import { useOnScreen } from "../../util/useOnScreen.js";
import { ColorizedParam } from "./ColorizedParam.js";
import { NonHighlightedCode } from "./components/NonHighlightedCode.js";
import { useOasConfig } from "./context.js";
import { GeneratedExampleSidecarBox } from "./GeneratedExampleSidecarBox.js";
import type { OperationsFragmentFragment } from "./graphql/graphql.js";
import { graphql } from "./graphql/index.js";
import { PlaygroundDialogWrapper } from "./PlaygroundDialogWrapper.js";
import { RequestBodySidecarBox } from "./RequestBodySidecarBox.js";
import { ResponsesSidecarBox } from "./ResponsesSidecarBox.js";
import * as SidecarBox from "./SidecarBox.js";
import { createHttpSnippet, getConverted } from "./util/createHttpSnippet.js";
import { generateSchemaExample } from "./util/generateSchemaExample.js";
import { methodForColor } from "./util/methodToColor.js";

export const GetServerQuery = graphql(/* GraphQL */ `
  query getServerQuery($input: JSON!, $type: SchemaType!) {
    schema(input: $input, type: $type) {
      url
      servers {
        url
      }
    }
  }
`);

const EXAMPLE_LANGUAGES = [
  { value: "shell", label: "cURL" },
  { value: "ts", label: "TypeScript" },
  { value: "python", label: "Python" },
  { value: "java", label: "Java" },
  { value: "go", label: "Go" },
  { value: "php", label: "PHP" },
  { value: "rust", label: "Rust" },
];

type LanguageOption = { value: string; label: string };

const CONNECTOR_LABELS: Record<string, string> = {
  ts: "TypeScript",
  python: "Python",
  java: "Java",
  go: "Go",
  rust: "Rust",
  php: "PHP",
};

const SHIKI_LANG_MAP: Record<string, string> = {
  ts: "typescript",
  python: "python",
  java: "java",
  go: "go",
  rust: "rust",
  php: "php",
  shell: "shellscript",
};

function parseConnectorsExamples(
  raw: unknown,
): Record<string, string> | undefined {
  if (!raw) return undefined;

  if (typeof raw === "object" && !Array.isArray(raw)) {
    const rec = raw as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(rec)) {
      if (typeof v === "string" && v.trim().length > 0)
        out[k.trim()] = v.trim();
    }
    return Object.keys(out).length ? out : undefined;
  }

  if (Array.isArray(raw)) {
    const out: Record<string, string> = {};
    for (const item of raw) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const rec = item as Record<string, unknown>;
        for (const [k, v] of Object.entries(rec)) {
          if (typeof v === "string" && v.trim().length > 0) {
            if (!out[k.trim()]) out[k.trim()] = v.trim();
          }
        }
      }
    }
    return Object.keys(out).length ? out : undefined;
  }

  return undefined;
}

async function checkUrlReachable(url: string): Promise<boolean> {
  try {
    const head = await fetch(url, { method: "HEAD" });
    if (head.ok) return true;
  } catch {
    /* */
  }

  try {
    const get = await fetch(url, {
      method: "GET",
      headers: { Range: "bytes=0-128" },
    });

    return get.ok;
  } catch {
    return false;
  }
}

export const Sidecar = ({
  operation,
  selectedResponse,
  globalSelectedServer,
  shouldLazyHighlight,
}: {
  operation: OperationsFragmentFragment;
  selectedResponse?: string;
  globalSelectedServer?: string;
  shouldLazyHighlight?: boolean;
}) => {
  const { options } = useOasConfig();
  const auth = useAuthState();
  const context = useZudoku();

  const methodTextColor = methodForColor(operation.method);

  const [searchParams, setSearchParams] = useSearchParams();
  const [, startTransition] = useTransition();

  const selectedServer =
    globalSelectedServer || operation.servers.at(0)?.url || "";
  const requestBodyContent = operation.requestBody?.content;
  const transformedRequestBodyContent =
    requestBodyContent && options?.transformExamples
      ? options.transformExamples({
          auth,
          type: "request",
          operation,
          content: requestBodyContent,
          context,
        })
      : requestBodyContent;

  const [selectedRequestExample, setSelectedRequestExample] = useState<{
    contentTypeIndex: number;
    exampleIndex: number;
  }>({ contentTypeIndex: 0, exampleIndex: 0 });

  const selectedContent = transformedRequestBodyContent?.at(
    selectedRequestExample.contentTypeIndex,
  );
  const currentExample = selectedContent?.examples?.at(
    selectedRequestExample.exampleIndex,
  );

  const currentExampleCode = currentExample
    ? (currentExample?.value ?? currentExample)
    : selectedContent?.schema
      ? generateSchemaExample(selectedContent?.schema)
      : undefined;

  const path = (
    <PathRenderer
      path={operation.path}
      renderParam={({ name }) => (
        <ColorizedParam
          name={name}
          backgroundOpacity="0"
          className="py-px px-0.5"
          // same as in `ParameterListItem`
          slug={`${operation.slug}-${name}`}
        >
          {`{${name}}`}
        </ColorizedParam>
      )}
    />
  );

  const connectorsExamples = useMemo(() => {
    const ext = (operation.extensions as Record<string, unknown> | undefined)?.[
      "x-connectors-examples"
    ];
    return parseConnectorsExamples(ext);
  }, [operation.extensions]);

  const [reachableConnectorLangs, setReachableConnectorLangs] = useState<
    Array<{ lang: string; url: string }>
  >([]);
  const [isCheckingConnectorUrls, setIsCheckingConnectorUrls] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!connectorsExamples) {
        setReachableConnectorLangs([]);
        return;
      }

      setIsCheckingConnectorUrls(true);

      const entries = Object.entries(connectorsExamples);
      const results = await Promise.allSettled(
        entries.map(async ([lang, url]) => {
          const ok = await checkUrlReachable(url);
          return ok ? { lang, url } : null;
        }),
      );

      if (cancelled) return;

      const reachable = results
        .map((r) => (r.status === "fulfilled" ? r.value : null))
        .filter(Boolean) as Array<{ lang: string; url: string }>;

      setReachableConnectorLangs(reachable);
      setIsCheckingConnectorUrls(false);
    }

    void run();

    return () => {
      cancelled = true;
    };
  }, [connectorsExamples]);

  const languageOptions: LanguageOption[] = useMemo(() => {
    if (!connectorsExamples) {
      return (options?.supportedLanguages ??
        EXAMPLE_LANGUAGES) as LanguageOption[];
    }

    const list: LanguageOption[] = [{ value: "shell", label: "cURL" }];

    for (const { lang } of reachableConnectorLangs) {
      if (lang === "shell") continue;
      if (list.some((x) => x.value === lang)) continue;
      list.push({
        value: lang,
        label: CONNECTOR_LABELS[lang] ?? lang.toUpperCase(),
      });
    }

    return list;
  }, [
    connectorsExamples,
    reachableConnectorLangs,
    options?.supportedLanguages,
  ]);

  const preferredLang = searchParams.get("lang") ?? "shell";

  const selectedLang =
    languageOptions.find((lang) => lang.value === preferredLang)?.value ??
    "shell";

  useEffect(() => {
    if (!languageOptions.some((x) => x.value === preferredLang)) {
      if (preferredLang !== "shell") {
        startTransition(() => {
          setSearchParams((prev) => {
            prev.set("lang", "shell");
            return prev;
          });
        });
      }
    }
  }, [languageOptions, preferredLang, setSearchParams]);

  const [connectorCode, setConnectorCode] = useState<string>("");
  const [connectorCodeLang, setConnectorCodeLang] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!connectorsExamples || selectedLang === "shell") {
        setConnectorCode("");
        setConnectorCodeLang("");
        return;
      }

      const url = connectorsExamples[selectedLang];
      if (!url) {
        setConnectorCode("");
        setConnectorCodeLang("");
        return;
      }

      try {
        const res = await fetch(url, { method: "GET" });
        if (!res.ok) {
          if (!cancelled) {
            setReachableConnectorLangs((prev) =>
              prev.filter((x) => x.lang !== selectedLang),
            );
            startTransition(() => {
              setSearchParams((prev) => {
                prev.set("lang", "shell");
                return prev;
              });
            });
          }
          return;
        }

        const text = await res.text();
        if (cancelled) return;

        setConnectorCode(text);
        setConnectorCodeLang(selectedLang);
      } catch {
        if (!cancelled) {
          setReachableConnectorLangs((prev) =>
            prev.filter((x) => x.lang !== selectedLang),
          );
          startTransition(() => {
            setSearchParams((prev) => {
              prev.set("lang", "shell");
              return prev;
            });
          });
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [connectorsExamples, selectedLang, setSearchParams]);

  const [ref, isOnScreen] = useOnScreen({ rootMargin: "200px 0px 200px 0px" });

  const showPlayground =
    isOnScreen &&
    (operation.extensions["x-explorer-enabled"] === true ||
      operation.extensions["x-zudoku-playground-enabled"] === true ||
      (operation.extensions["x-explorer-enabled"] === undefined &&
        operation.extensions["x-zudoku-playground-enabled"] === undefined &&
        !options?.disablePlayground));

  const hasResponseExamples = operation.responses.some((response) =>
    response.content?.some((content) => (content.examples?.length ?? 0) > 0),
  );

  const snippetLanguageForHighlight =
    selectedLang === "shell" ? "shell" : connectorCodeLang || selectedLang;

  const highlightLang =
    SHIKI_LANG_MAP[snippetLanguageForHighlight] ?? snippetLanguageForHighlight;

  const safeHighlightLang = highlightLang || "text";

  const codeToRender =
    selectedLang === "shell"
      ? (options?.generateCodeSnippet?.({
          selectedLang: "shell",
          selectedServer,
          context,
          operation,
          example: currentExampleCode,
          auth,
        }) ??
        (() => {
          const snippet = createHttpSnippet({
            operation,
            selectedServer,
            exampleBody: currentExampleCode
              ? {
                  mimeType: selectedContent?.mediaType ?? "application/json",
                  text: JSON.stringify(currentExampleCode, null, 2),
                }
              : { mimeType: selectedContent?.mediaType ?? "application/json" },
          });
          return getConverted(snippet, "shell");
        })())
      : connectorCode;

  return (
    <aside
      ref={ref}
      className="flex flex-col sticky top-(--scroll-padding) gap-4"
      data-pagefind-ignore="all"
    >
      <SidecarBox.Root>
        <SidecarBox.Head className="py-1.5">
          <div className="flex items-center flex-wrap gap-2 justify-between w-full">
            <span className="font-mono wrap-break-word leading-6 space-x-1">
              <Badge
                variant="outline"
                className={cn(
                  methodTextColor,
                  "px-1.5 rounded-md border-none bg-current/7 dark:bg-current/15",
                )}
              >
                {operation.method.toUpperCase()}
              </Badge>
              {path}
            </span>
            <div className="flex items-center gap-1">
              <NativeSelect
                className="py-0.5 h-fit max-w-32 truncate bg-background"
                value={selectedLang}
                disabled={!!connectorsExamples && isCheckingConnectorUrls}
                onChange={(e) => {
                  startTransition(() => {
                    setSearchParams((prev) => {
                      prev.set("lang", e.target.value);
                      return prev;
                    });
                  });
                }}
              >
                {connectorsExamples && isCheckingConnectorUrls ? (
                  <NativeSelectOption value="shell">
                    Loading…
                  </NativeSelectOption>
                ) : (
                  languageOptions.map((language) => (
                    <NativeSelectOption
                      key={language.value}
                      value={language.value}
                    >
                      {language.label}
                    </NativeSelectOption>
                  ))
                )}
              </NativeSelect>
              {showPlayground && (
                <PlaygroundDialogWrapper
                  servers={operation.servers.map((server) => server.url)}
                  operation={operation}
                  examples={requestBodyContent ?? undefined}
                />
              )}
            </div>
          </div>
        </SidecarBox.Head>

        <SidecarBox.Body>
          {shouldLazyHighlight && !isOnScreen ? (
            <NonHighlightedCode code={codeToRender ?? ""} />
          ) : (
            <SyntaxHighlight
              embedded
              showLanguageIndicator={false}
              language={safeHighlightLang}
              className="[--scrollbar-color:gray] rounded-none text-xs max-h-50"
              code={codeToRender ?? ""}
            />
          )}
        </SidecarBox.Body>
      </SidecarBox.Root>

      {transformedRequestBodyContent && currentExample ? (
        <RequestBodySidecarBox
          content={transformedRequestBodyContent}
          onExampleChange={(selected) => {
            setSelectedRequestExample(selected);
          }}
          selectedContentIndex={selectedRequestExample.contentTypeIndex}
          selectedExampleIndex={selectedRequestExample.exampleIndex}
          isOnScreen={isOnScreen}
          shouldLazyHighlight={shouldLazyHighlight}
        />
      ) : transformedRequestBodyContent && currentExampleCode ? (
        <GeneratedExampleSidecarBox
          isOnScreen={isOnScreen}
          shouldLazyHighlight={shouldLazyHighlight}
          code={JSON.stringify(currentExampleCode, null, 2)}
        />
      ) : null}

      {hasResponseExamples ? (
        <ResponsesSidecarBox
          isOnScreen={isOnScreen}
          shouldLazyHighlight={shouldLazyHighlight}
          selectedResponse={selectedResponse}
          responses={operation.responses.map((response) => ({
            ...response,
            content:
              response.content && options?.transformExamples
                ? options.transformExamples({
                    auth,
                    type: "response",
                    context,
                    operation,
                    content: response.content,
                  })
                : response.content,
          }))}
        />
      ) : (
        <ResponsesSidecarBox
          isGenerated
          isOnScreen={isOnScreen}
          shouldLazyHighlight={shouldLazyHighlight}
          selectedResponse={selectedResponse}
          responses={operation.responses.map((response) => ({
            ...response,
            content: response.content?.map((content) => ({
              ...content,
              examples: content.schema
                ? [{ name: "", value: generateSchemaExample(content.schema) }]
                : content.examples,
            })),
          }))}
        />
      )}
    </aside>
  );
};
