import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  StreamableFile,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface Response<T> {
  success: boolean;
  data: T;
  meta?: any;
}

@Injectable()
export class TransformInterceptor<T>
  implements NestInterceptor<T, Response<T>>
{
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<Response<T>> {
    const ctx = context.switchToHttp();
    const request = ctx.getRequest();

    // Do not intercept Better Auth routes or anything that might break if we wrap it.
    // However, our Better Auth routes are on /api/auth which bypasses NestJS interceptors anyway 
    // because we mount it in express directly. But just in case, we can ignore them if they ever hit here.
    if (request.url.startsWith('/api/auth')) {
      return next.handle();
    }

    return next.handle().pipe(
      map((data) => {
        // Arquivos (ex.: logos) vão como bytes, sem o envelope JSON
        if (data instanceof StreamableFile) {
          return data;
        }

        // Handle undefined or null
        if (data === undefined || data === null) {
          return {
            success: true,
            data,
          };
        }

        // If the response is already in our standard format (maybe returned by a controller manually), return it
        if (typeof data === 'object' && 'success' in data && 'data' in data) {
          return data;
        }

        // Handle Paginated Responses which return { data: [...], meta: {...} }
        if (
          typeof data === 'object' &&
          'data' in data &&
          'meta' in data
        ) {
          return {
            success: true,
            data: data.data,
            meta: data.meta,
          };
        }

        // Default successful response
        return {
          success: true,
          data,
        };
      }),
    );
  }
}
