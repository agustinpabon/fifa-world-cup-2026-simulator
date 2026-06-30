import type { Response } from "express";

export type ApiErrorIssue = {
  path?: string;
  message: string;
  code?: string;
};

export type ApiErrorPayload = {
  code: string;
  message: string;
  issues?: ApiErrorIssue[];
};

export type ApiSuccessBody<TData, TMeta extends Record<string, unknown> | undefined = undefined> =
  TMeta extends Record<string, unknown>
    ? { data: TData; meta: TMeta }
    : { data: TData };

export type ApiErrorBody = {
  error: ApiErrorPayload;
};

export function sendApiSuccess<TData, TMeta extends Record<string, unknown>>(
  res: Response,
  data: TData,
  meta: TMeta
): Response<ApiSuccessBody<TData, TMeta>>;
export function sendApiSuccess<TData>(
  res: Response,
  data: TData
): Response<ApiSuccessBody<TData>>;
export function sendApiSuccess<TData, TMeta extends Record<string, unknown>>(
  res: Response,
  data: TData,
  meta?: TMeta
): Response<ApiSuccessBody<TData, TMeta> | ApiSuccessBody<TData>> {
  if (meta) {
    return res.json({ data, meta });
  }

  return res.json({ data });
}

export function sendApiError(
  res: Response,
  status: number,
  error: ApiErrorPayload
): Response<ApiErrorBody> {
  const body: ApiErrorBody = {
    error: {
      code: error.code,
      message: error.message,
      ...(error.issues ? { issues: error.issues } : {}),
    },
  };

  return res.status(status).json(body);
}
