import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let details = undefined;
    let code: string | number = HttpStatus.INTERNAL_SERVER_ERROR;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
        code = status;
      } else if (
        typeof exceptionResponse === 'object' &&
        exceptionResponse !== null
      ) {
        const res = exceptionResponse as any;
        // Typically NestJS ValidationPipe returns an array of messages in `message`
        if (Array.isArray(res.message)) {
          message = 'Validation failed';
          details = res.message;
        } else if (typeof res.message === 'string') {
          message = res.message;
        }

        // Regras de negócio podem enviar uma mensagem principal + lista de problemas
        if (Array.isArray(res.details)) {
          details = res.details;
        }

        if (res.error) {
          if (!details) {
            details = [res.error];
          } else if (Array.isArray(details)) {
            details.push(res.error);
          }
        }

        if (res.statusCode) {
          code = res.statusCode;
        } else {
          code = status;
        }
      }
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    response.status(status).json({
      success: false,
      error: {
        message,
        code,
        details,
      },
    });
  }
}
