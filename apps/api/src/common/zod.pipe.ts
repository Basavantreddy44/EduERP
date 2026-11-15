import { HttpStatus, PipeTransform } from '@nestjs/common';
import type { ZodTypeAny, z } from 'zod';
import { AppError } from './problem';

/** Validates and normalises request input with a shared Zod schema (same schema the web form uses). */
export class ZodPipe<S extends ZodTypeAny> implements PipeTransform<unknown, z.infer<S>> {
  constructor(readonly schema: S) {}

  transform(value: unknown): z.infer<S> {
    const parsed = this.schema.safeParse(value ?? {});
    if (!parsed.success) {
      const errors = parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
      throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'validation-failed', 'Some fields are invalid', errors);
    }
    return parsed.data;
  }
}

export const zod = <S extends ZodTypeAny>(schema: S) => new ZodPipe(schema);
