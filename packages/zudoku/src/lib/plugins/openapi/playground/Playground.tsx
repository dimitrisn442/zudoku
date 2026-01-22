/** biome-ignore-all lint/suspicious/noExplicitAny: <test> */
import { useNProgress } from "@tanem/react-nprogress";
import { useMutation } from "@tanstack/react-query";
import {
  CheckIcon,
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  IdCardLanyardIcon,
  KeyRoundIcon,
  ShapesIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { Button } from "zudoku/ui/Button.js";
import { Collapsible, CollapsibleContent } from "zudoku/ui/Collapsible.js";
import { Input } from "zudoku/ui/Input.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "zudoku/ui/Select.js";
import { TooltipProvider } from "zudoku/ui/Tooltip.js";
import { useApiIdentities } from "../../../components/context/ZudokuContext.js";
import { useHotkey } from "../../../hooks/useHotkey.js";
import { cn } from "../../../util/cn.js";
import { useCopyToClipboard } from "../../../util/useCopyToClipboard.js";
import { useLatest } from "../../../util/useLatest.js";
import type { MediaTypeObject } from "../graphql/graphql.js";
import { useSelectedServer } from "../state.js";
import BodyPanel from "./BodyPanel.js";
import {
  CollapsibleHeader,
  CollapsibleHeaderTrigger,
} from "./CollapsibleHeader.js";
import { createUrl } from "./createUrl.js";
import { extractFileName, isBinaryContentType } from "./fileUtils.js";
import { Headers } from "./Headers.js";
import { IdentityDialog } from "./IdentityDialog.js";
import IdentitySelector from "./IdentitySelector.js";
import { PathParams } from "./PathParams.js";
import { QueryParams } from "./QueryParams.js";
import RequestLoginDialog from "./RequestLoginDialog.js";
import { useIdentityStore } from "./rememberedIdentity.js";
import { UrlPath } from "./request-panel/UrlPath.js";
import { UrlQueryParams } from "./request-panel/UrlQueryParams.js";
import { ResultPanel } from "./result-panel/ResultPanel.js";
import { useRememberSkipLoginDialog } from "./useRememberSkipLoginDialog.js";

export const NO_IDENTITY = "__none";

function serializeValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value) || (typeof value === "object" && value !== null))
    return JSON.stringify(value);
  return String(value);
}

export function buildQueryString(params: Record<string, unknown>): string {
  if (!params) return "";
  const pairs: string[] = [];
  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined) {
      const serializedValue = serializeValue(value);
      pairs.push(`${key}=${encodeURIComponent(serializedValue)}`);
    }
  });
  return pairs.join("&");
}

function bufferToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i]?.toString(16).padStart(2, "0");
  }
  return hex;
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return bufferToHex(sig);
}

function toRecordFromActivePairs(
  pairs: Array<{ name: string; value: string; active?: boolean }>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of pairs) {
    if (!p.name) continue;
    if (p.active === false) continue;
    out[p.name] = p.value;
  }
  return out;
}

function tryParseJsonObject(text: string): Record<string, unknown> | undefined {
  const t = (text ?? "").trim();
  if (!t) return undefined;
  if (!(t.startsWith("{") && t.endsWith("}"))) return undefined;
  try {
    const parsed = JSON.parse(t);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      return parsed as Record<string, unknown>;
  } catch {
    // ignore
  }
  return undefined;
}

function upsertActiveParam(
  params: Array<{
    name: string;
    value: string;
    active: boolean;
    enum?: string[];
  }>,
  name: string,
  value: string,
) {
  const idx = params.findIndex((p) => p.name === name);
  if (idx >= 0) {
    if (params[idx])
      params[idx] = {
        ...params[idx],
        name: params[idx].name,
        value,
        active: true,
      };
  } else {
    params.push({ name, value, active: true, enum: [] });
  }
}

function getHeaderValue(
  headers: Array<{ name: string; value: string; active: boolean }>,
  headerName: string,
): string {
  const h = headers.find((x) => x.name === headerName);
  if (!h || !h.active) return "";
  return (h.value ?? "").trim();
}

function getProxyUrl(): string {
  const w = window as unknown as {
    __ZUDOKU_PLAYGROUND_PROXY_URL__?: string;
  };
  if (w.__ZUDOKU_PLAYGROUND_PROXY_URL__)
    return w.__ZUDOKU_PLAYGROUND_PROXY_URL__;

  const envUrl = (import.meta as any)?.env?.VITE_ZUDOKU_PLAYGROUND_PROXY_URL as
    | string
    | undefined;
  if (envUrl) return envUrl;

  return "/__zudoku/playground/proxy";
}

export type Header = {
  name: string;
  defaultValue?: string;
  defaultActive?: boolean;
  isRequired?: boolean;
  enum?: string[];
  type?: string;
};

export type QueryParam = {
  name: string;
  defaultValue?: string;
  defaultActive?: boolean;
  isRequired?: boolean;
  enum?: string[];
  type?: string;
};

export type PathParam = {
  name: string;
  defaultValue?: string;
  isRequired?: boolean;
};

export type PlaygroundForm = {
  apiSecret?: string;
  body: string;
  bodyMode?: "text" | "file" | "multipart";
  file?: File | null;
  multipartFormFields: Array<{
    name: string;
    value: File | string;
    active: boolean;
  }>;
  queryParams: Array<{
    name: string;
    value: string;
    active: boolean;
    enum?: string[];
  }>;
  pathParams: Array<{ name: string; value: string }>;
  headers: Array<{
    name: string;
    value: string;
    active: boolean;
    enum?: string[];
  }>;
  identity?: string;
};

export type PlaygroundResult = {
  status: number;
  headers: Array<[string, string]>;
  size: number;
  body: string;
  time: number;
  isBinary?: boolean;
  fileName?: string;
  blob?: Blob;
  request: {
    method: string;
    url: string;
    headers: Array<[string, string]>;
    body?: string;
  };
};

export type PlaygroundContentProps = {
  server?: string;
  servers?: string[];
  url: string;
  method: string;
  headers?: Header[];
  queryParams?: QueryParam[];
  pathParams?: PathParam[];
  defaultBody?: string;
  examples?: MediaTypeObject[];
  requiresLogin?: boolean;
  isSigned?: boolean;
  apiKeyHeaderName?: string;
  onLogin?: () => void;
  onSignUp?: () => void;
};

export const Playground = ({
  server,
  servers = [],
  url,
  method,
  headers = [],
  queryParams = [],
  pathParams = [],
  defaultBody = "",
  examples,
  requiresLogin = false,
  onLogin,
  onSignUp,
  isSigned = false,
  apiKeyHeaderName = "X-MBX-APIKEY",
}: PlaygroundContentProps) => {
  const { selectedServer, setSelectedServer } = useSelectedServer(
    servers.map((url) => ({ url })),
  );
  const [showSelectIdentity, setShowSelectIdentity] = useState(false);
  const identities = useApiIdentities();
  const { setRememberedIdentity, getRememberedIdentity } = useIdentityStore();
  const [, startTransition] = useTransition();
  const { skipLogin, setSkipLogin } = useRememberSkipLoginDialog();
  const [isLoginDialogDismissed, setIsLoginDialogDismissed] = useState(false);
  const [showLongRunningWarning, setShowLongRunningWarning] = useState(false);
  const abortControllerRef = useRef<AbortController | undefined>(undefined);
  const latestSetRememberedIdentity = useLatest(setRememberedIdentity);
  const formRef = useRef<HTMLFormElement>(null);

  const [showSecret, setShowSecret] = useState(false);

  const { label: hotkeyLabel } = useHotkey("meta+enter", () => {
    formRef.current?.requestSubmit();
  });

  const pathParamOrder =
    url.match(/\{([^}]+)\}/g)?.map((match) => match.slice(1, -1)) ?? [];
  const sortedPathParams = [...pathParams].sort(
    (a, b) => pathParamOrder.indexOf(a.name) - pathParamOrder.indexOf(b.name),
  );

  const { register, control, handleSubmit, watch, setValue, ...form } =
    useForm<PlaygroundForm>({
      defaultValues: {
        apiSecret: "",
        body: defaultBody,
        bodyMode: "text",
        file: null,
        multipartFormFields: [],
        queryParams:
          queryParams.length > 0
            ? queryParams.map((param) => ({
                name: param.name,
                value: param.defaultValue ?? "",
                active: param.isRequired ?? false,
                enum: param.enum ?? [],
              }))
            : [{ name: "", value: "", active: false, enum: [] }],
        pathParams: sortedPathParams.map((param) => ({
          name: param.name,
          value: param.defaultValue ?? "",
        })),
        headers:
          headers.length > 0
            ? headers.map((header) => ({
                name: header.name,
                value: header.defaultValue ?? "",
                active: header.isRequired ?? false,
              }))
            : [{ name: "", value: "", active: false }],
        identity: getRememberedIdentity([
          NO_IDENTITY,
          ...(identities.data?.map((i) => i.id) ?? []),
        ]),
      },
    });
  const identity = watch("identity");

  const authorizationFields = useMemo(
    () => identities.data?.find((i) => i.id === identity)?.authorizationFields,
    [identities.data, identity],
  );

  useEffect(() => {
    if (identity) {
      latestSetRememberedIdentity.current(identity);
    }
  }, [latestSetRememberedIdentity, identity]);

  const queryMutation = useMutation({
    gcTime: 0,
    mutationFn: async (data: PlaygroundForm) => {
      const start = performance.now();

      const signedData: PlaygroundForm = {
        ...data,
        queryParams: [...(data.queryParams ?? [])],
        headers: [...(data.headers ?? [])],
      };

      if (isSigned) {
        const apiSecret = (signedData.apiSecret ?? "").trim();
        if (!apiSecret)
          throw new Error("API Secret is required for signed endpoints.");

        const apiKey = getHeaderValue(signedData.headers, apiKeyHeaderName);
        if (!apiKey) {
          throw new Error(
            `Missing ${apiKeyHeaderName} header. Enable it in Headers and provide your API key.`,
          );
        }

        upsertActiveParam(
          signedData.queryParams,
          "timestamp",
          String(Date.now()),
        );

        const qp = toRecordFromActivePairs(
          signedData.queryParams.filter((p) => p.name !== "signature"),
        );

        const bodyParams =
          signedData.bodyMode === "text"
            ? tryParseJsonObject(signedData.body)
            : undefined;

        const queryParamsString = buildQueryString(qp);
        const bodyParamsString = bodyParams ? buildQueryString(bodyParams) : "";

        const toSign = [queryParamsString, bodyParamsString]
          .filter(Boolean)
          .join("&");

        const signature = await hmacSha256Hex(apiSecret, toSign);
        upsertActiveParam(signedData.queryParams, "signature", signature);
      }

      const finalUrl = createUrl(
        server ?? selectedServer,
        url,
        signedData,
      ).toString();

      const hdrs = new window.Headers(
        signedData.headers
          .filter((h) => h.name && h.active)
          .map<[string, string]>((h) => [h.name, h.value]),
      );

      let body: string | FormData | File | undefined;

      switch (signedData.bodyMode) {
        case "file":
          body = signedData.file || undefined;
          hdrs.delete("Content-Type");
          break;
        case "multipart": {
          const formData = new FormData();
          signedData.multipartFormFields
            ?.filter((field) => field.name && field.active)
            .forEach((field) => formData.append(field.name, field.value));
          body = formData;
          hdrs.delete("Content-Type");
          break;
        }
        default:
          body = signedData.body || undefined;
          break;
      }

      const requestHeadersForSend: Array<[string, string]> = Array.from(
        hdrs.entries(),
      );

      const requestBodyForSend = ["GET", "HEAD"].includes(method.toUpperCase())
        ? undefined
        : body;

      const proxyUrl = getProxyUrl();

      const warningTimeout = setTimeout(
        () => setShowLongRunningWarning(true),
        3210,
      );
      abortControllerRef.current = new AbortController();
      abortControllerRef.current.signal.addEventListener("abort", () => {
        clearTimeout(warningTimeout);
      });

      try {
        if (signedData.identity !== NO_IDENTITY) {
          const tmpReq = new Request(finalUrl, {
            method,
            headers: hdrs,
            body: ["GET", "HEAD"].includes(method.toUpperCase())
              ? null
              : requestBodyForSend,
          });

          await identities.data
            ?.find((i) => i.id === signedData.identity)
            ?.authorizeRequest(tmpReq);

          requestHeadersForSend.splice(
            0,
            requestHeadersForSend.length,
            ...Array.from(tmpReq.headers.entries()),
          );
        }

        const proxyRes = await fetch(proxyUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: abortControllerRef.current.signal,
          cache: "no-store",
          body: JSON.stringify({
            method: method.toUpperCase(),
            url: finalUrl,
            headers: requestHeadersForSend,
            body:
              typeof requestBodyForSend === "string"
                ? requestBodyForSend
                : requestBodyForSend instanceof File
                  ? undefined
                  : requestBodyForSend instanceof FormData
                    ? undefined
                    : undefined,
          }),
        });

        clearTimeout(warningTimeout);
        setShowLongRunningWarning(false);

        const time = performance.now() - start;

        if (!proxyRes.ok) {
          const msg = await proxyRes.text();
          throw new Error(msg || `Proxy request failed (${proxyRes.status})`);
        }

        const payload = (await proxyRes.json()) as {
          status: number;
          headers: Array<[string, string]>;
          body: string;
          size?: number;
          contentType?: string;
        };

        const responseHeaders = payload.headers ?? [];
        const contentType =
          payload.contentType ??
          responseHeaders.find(
            ([k]) => k.toLowerCase() === "content-type",
          )?.[1] ??
          "";

        const isBinary = isBinaryContentType(contentType);

        const responseBody = payload.body ?? "";

        const responseSize =
          typeof payload.size === "number" ? payload.size : responseBody.length;

        const urlObj = new URL(finalUrl);

        let requestBodyDebug = "";
        switch (signedData.bodyMode) {
          case "text":
            requestBodyDebug = signedData.body;
            break;
          case "file":
            requestBodyDebug = `[File: ${signedData.file?.name ?? "Unknown"}]`;
            break;
          case "multipart":
            requestBodyDebug = "[Multipart Form Data]";
            break;
          default:
            requestBodyDebug = signedData.body;
            break;
        }

        return {
          status: payload.status,
          headers: responseHeaders,
          size: responseSize,
          body: responseBody,
          time,
          isBinary,
          fileName: extractFileName(responseHeaders, finalUrl),
          request: {
            method: method.toUpperCase(),
            url: finalUrl,
            headers: [
              ["Host", urlObj.host],
              ["User-Agent", "Binance Developer Docs Playground"],
              ...requestHeadersForSend,
            ],
            body: requestBodyDebug,
          },
        } satisfies PlaygroundResult;
      } catch (error) {
        clearTimeout(warningTimeout);
        setShowLongRunningWarning(false);
        if (error instanceof TypeError) {
          throw new Error(
            "The request failed, possibly due to network issues or proxy issues.",
          );
        }
        throw error;
      }
    },
  });

  const isRequestAnimating = queryMutation.isPending;
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setIsAnimating(isRequestAnimating), 100);
    return () => clearTimeout(timer);
  }, [isRequestAnimating]);

  const { isFinished, progress } = useNProgress({ isAnimating });

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const serverSelect = (
    <div className="inline-block opacity-50 hover:opacity-100 transition">
      {server ? (
        <span>{server.replace(/^https?:\/\//, "").replace(/\/$/, "")}</span>
      ) : (
        servers.length > 1 && (
          <Select
            onValueChange={(value) => {
              startTransition(() => setSelectedServer(value));
            }}
            value={selectedServer}
            defaultValue={selectedServer}
          >
            <SelectTrigger className="p-0 h-fit shadow-none border-none flex-row-reverse bg-transparent text-xs gap-0.5 translate-y-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {servers.map((s) => (
                <SelectItem key={s} value={s}>
                  {s.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )
      )}
    </div>
  );

  const showLogin = requiresLogin && !skipLogin && !isLoginDialogDismissed;
  const isBodySupported = ["POST", "PUT", "PATCH", "DELETE"].includes(
    method.toUpperCase(),
  );
  const [isCopied, copyToClipboard] = useCopyToClipboard();

  return (
    <FormProvider
      {...{ register, control, handleSubmit, watch, setValue, ...form }}
    >
      <TooltipProvider delayDuration={150}>
        <form
          ref={formRef}
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
              e.preventDefault();
            }
          }}
          onSubmit={handleSubmit((data) => {
            if (identities.data?.length === 0 || data.identity) {
              queryMutation.mutate(data);
            } else {
              setShowSelectIdentity(true);
            }
          })}
          className="relative"
        >
          <IdentityDialog
            identities={identities.data ?? []}
            open={showSelectIdentity}
            onOpenChange={setShowSelectIdentity}
            onSubmit={({ rememberedIdentity, identity }) => {
              if (rememberedIdentity) {
                setValue("identity", identity ?? NO_IDENTITY);
              }
              setShowSelectIdentity(false);
              queryMutation.mutate({ ...form.getValues(), identity });
            }}
          />

          <RequestLoginDialog
            open={showLogin}
            setOpen={(open) => {
              if (!open) setIsLoginDialogDismissed(true);
            }}
            onSkip={(rememberSkip) => {
              setIsLoginDialogDismissed(true);
              if (rememberSkip) setSkipLogin(true);
            }}
            onSignUp={onSignUp}
            onLogin={onLogin}
          />

          <div className="grid grid-cols-[1fr_1px_1fr] text-sm">
            <div className="col-span-3 p-4 border-b flex gap-2 items-stretch">
              <div className="flex flex-1 items-center w-full border rounded-md relative overflow-hidden">
                <div className="border-r p-2 bg-muted rounded-l-md self-stretch font-semibold font-mono flex items-center">
                  {method.toUpperCase()}
                </div>
                <div className="items-center px-2 font-mono text-xs break-all leading-6 relative h-full w-full">
                  <div className="h-full py-1.5">
                    {serverSelect}
                    <UrlPath url={url} />
                    <UrlQueryParams />
                  </div>
                </div>
                <div className="px-1">
                  <Button
                    type="button"
                    onClick={() => {
                      copyToClipboard(
                        createUrl(
                          server ?? selectedServer,
                          url,
                          form.getValues(),
                        ).toString(),
                      );
                    }}
                    variant="ghost"
                    size="icon-xs"
                    className={cn(
                      "hover:opacity-100 transition",
                      isCopied ? "text-emerald-600 opacity-100" : "opacity-50",
                    )}
                  >
                    {isCopied ? (
                      <CheckIcon className="text-green-500" size={14} />
                    ) : (
                      <CopyIcon size={14} />
                    )}
                  </Button>
                </div>
              </div>

              <Button
                type="submit"
                variant={queryMutation.isPending ? "destructive" : "default"}
                onClick={(e) => {
                  if (queryMutation.isPending) {
                    abortControllerRef.current?.abort(
                      "Request cancelled by user",
                    );
                    e.preventDefault();
                  }
                }}
                className="w-18"
              >
                {queryMutation.isPending ? "Cancel" : "Send"}
              </Button>
            </div>

            <div className="relative overflow-y-auto h-[80vh]">
              {identities.data?.length !== 0 && (
                <Collapsible defaultOpen>
                  <CollapsibleHeaderTrigger>
                    <IdCardLanyardIcon size={16} />
                    <CollapsibleHeader>Authentication</CollapsibleHeader>
                  </CollapsibleHeaderTrigger>
                  <CollapsibleContent className="CollapsibleContent">
                    <IdentitySelector
                      value={identity}
                      identities={identities.data ?? []}
                      setValue={(value) => setValue("identity", value)}
                    />
                  </CollapsibleContent>
                </Collapsible>
              )}

              {sortedPathParams.length > 0 && (
                <Collapsible defaultOpen>
                  <CollapsibleHeaderTrigger>
                    <ShapesIcon size={16} />
                    <CollapsibleHeader>Path Parameters</CollapsibleHeader>
                  </CollapsibleHeaderTrigger>
                  <CollapsibleContent className="CollapsibleContent">
                    <PathParams url={url} control={control} />
                  </CollapsibleContent>
                </Collapsible>
              )}

              <Headers
                control={control}
                schemaHeaders={headers}
                lockedHeaders={authorizationFields?.headers}
              />

              <QueryParams control={control} schemaQueryParams={queryParams} />

              {isBodySupported && <BodyPanel content={examples} />}

              {isSigned && (
                <Collapsible defaultOpen>
                  <CollapsibleHeaderTrigger>
                    <KeyRoundIcon size={16} />
                    <CollapsibleHeader>Signature</CollapsibleHeader>
                  </CollapsibleHeaderTrigger>
                  <CollapsibleContent className="CollapsibleContent">
                    <div className="rounded-md border bg-muted/20 p-3 space-y-2">
                      <div className="text-xs text-muted-foreground leading-5">
                        Uses{" "}
                        <span className="font-mono">{apiKeyHeaderName}</span>{" "}
                        from
                        <b> Headers</b>. Enter your API Secret to generate{" "}
                        <span className="font-mono">timestamp</span> +{" "}
                        <span className="font-mono">signature</span>.
                      </div>

                      <div className="flex gap-2 items-center">
                        <div className="flex-1">
                          <Input
                            placeholder="API Secret"
                            type={showSecret ? "text" : "password"}
                            autoComplete="off"
                            {...register("apiSecret")}
                          />
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={() => setShowSecret((s) => !s)}
                          title={showSecret ? "Hide" : "Show"}
                        >
                          {showSecret ? (
                            <EyeOffIcon size={16} />
                          ) : (
                            <EyeIcon size={16} />
                          )}
                        </Button>
                      </div>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              )}
            </div>

            <div className="w-full bg-muted-foreground/20" />

            <ResultPanel
              queryMutation={queryMutation}
              showLongRunningWarning={showLongRunningWarning}
              isFinished={isFinished}
              progress={progress}
              tip={
                <div className="text-xs w-full">
                  <span className="text-muted-foreground">
                    Press{" "}
                    <kbd className="text-foreground border rounded m-0.5 px-1 py-0.5 capitalize">
                      {hotkeyLabel.join(" + ")}
                    </kbd>{" "}
                    to send a request
                  </span>
                </div>
              }
              onCancel={() => {
                abortControllerRef.current?.abort(
                  "Request cancelled by the user",
                );
                setShowLongRunningWarning(false);
              }}
            />
          </div>
        </form>
      </TooltipProvider>
    </FormProvider>
  );
};

export default Playground;
