import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';

/** Business/HTTP error carrying a stable machine-readable `code` (RFC 9457 problem details `type`). */
export class AppError extends HttpException {
  constructor(status: HttpStatus, readonly code: string, detail: string, readonly errors?: unknown) {
    super(detail, status);
  }
}

export const NotFound = (what = 'Resource') => new AppError(HttpStatus.NOT_FOUND, 'not-found', `${what} not found`);
export const Forbidden = (code = 'forbidden', detail = 'You do not have permission for this action') =>
  new AppError(HttpStatus.FORBIDDEN, code, detail);
export const Unauthorized = (code = 'unauthenticated', detail = 'Login required') =>
  new AppError(HttpStatus.UNAUTHORIZED, code, detail);
export const Conflict = (code: string, detail: string) => new AppError(HttpStatus.CONFLICT, code, detail);

/** Converts every error into application/problem+json. Internal errors never leak details. */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly log = new Logger('Error');

  catch(err: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request & { id?: string }>();
    const res = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'internal-error';
    let detail = 'Something went wrong. Please try again; if it continues, contact support with the request id.';
    let errors: unknown;

    if (err instanceof AppError) {
      status = err.getStatus();
      code = err.code;
      detail = err.message;
      errors = err.errors;
    } else if (err instanceof HttpException) {
      status = err.getStatus();
      code = status === 404 ? 'not-found' : `http-${status}`;
      detail = err.message;
    } else if (isPrismaKnown(err) && err.code === 'P2002') {
      status = HttpStatus.CONFLICT;
      code = 'duplicate';
      detail = 'A record with the same unique value already exists';
    } else {
      this.log.error({ err, requestId: req.id }, 'Unhandled error');
    }

    res
      .status(status)
      .type('application/problem+json')
      .json({ type: code, title: HttpStatus[status] ?? 'Error', status, detail, instance: req.originalUrl, requestId: req.id, errors });
  }
}

function isPrismaKnown(e: unknown): e is { code: string } {
  return typeof e === 'object' && e !== null && 'code' in e && (e as { name?: string }).name === 'PrismaClientKnownRequestError';
}
